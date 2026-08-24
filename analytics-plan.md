# Analytics Implementation Plan

> Execution plan for `analytics-arch.md`. That document is the **design**; this one is the
> **build order**, the corrections the design needs to actually run, and the two additions it
> does not cover: a second dashboard pointed at the local database, and a bot-driven E2E
> suite that populates it through real channels.
>
> Status: **Phases 1–4 complete and verified.** Phases 5–8 outstanding. Migrations `0006` and
> `0007` are applied to both local and production Supabase as of 2026-08-10.
> Read `analytics-arch.md` first for *why*; read this for *what to type*.

---

## Table of contents

1. [Why this document exists](#1-why-this-document-exists)
2. [Decisions already taken](#2-decisions-already-taken)
3. [Corrections to `analytics-arch.md`](#3-corrections-to-analytics-archmd)
4. [Phase 1 — Foundation](#phase-1--foundation)
5. [Phase 2 — Web funnel](#phase-2--web-funnel)
6. [Phase 3 — The two dashboards](#phase-3--the-two-dashboards)
7. [Phase 4 — Billing](#phase-4--billing)
8. [Phase 5 — The bot E2E suite](#phase-5--the-bot-e2e-suite)
9. [Phase 6 — Desktop milestones and approximate usage](#phase-6--desktop-milestones-and-approximate-usage)
10. [Phase 7 — Exact usage: the Rust transition log](#phase-7--exact-usage-the-rust-transition-log)
11. [Phase 8 — Polish](#phase-8--polish)
12. [Verification](#verification)
13. [Hazards](#hazards)

---

## 1. Why this document exists

`analytics-arch.md` is a 1092-line design whose own status line reads *"Status: design. Nothing
in this document is implemented yet."* That was accurate. Today `todo.org` line 2 — "get
analytics" — is unanswerable: half the funnel (download → install → service install → pairing
→ first session) is entirely dark, and "how many hours of focus did we deliver yesterday"
cannot be computed at all.

Two things about the design needed changing before it could be built.

**First, it is not runnable as written.** Three of its SQL blocks fail on contact with a real
Postgres — not stylistically, but with hard errors on the first realistic input. §3 below
records each one with the evidence, because "the doc is wrong here" is a claim that deserves
proof.

**Second, it has one dashboard, reading production.** For developing instrumentation that is
the wrong tool: you cannot iterate against production data, and you certainly cannot let a
test suite write to it. So we add a second dashboard at a second URL reading the local
Supabase postgres, clearly labelled DEV, plus a rarely-run bot suite that drives the real
ingest channels in dev mode so that what shows up on the dev dashboard is what a real user
would have produced.

---

## 2. Decisions already taken

| Decision | Choice |
|---|---|
| Scope | All 8 phases, **including** the Rust transition log (phase 7) |
| Dashboard credentials | `sync-env.ts` always writes **both** target credential sets; both dashboards work under `pnpm web:dev` *and* `pnpm web:prod` |
| Bot suite billing | **Signed fixture Stripe webhooks** (real `constructEvent`, real route handler), not real test-mode checkout |
| Bot suite data | **Truncates `analytics_*` in the local DB before each run**, behind a guard that refuses any non-localhost target |

---

## 3. Corrections to `analytics-arch.md`

Fold these back into `analytics-arch.md` as each phase lands, so the design document stays
the source of truth rather than drifting into fiction.

### 3.1 `analytics_report_usage` fails on every real row — VERIFIED

§7.1's body is:

```sql
with incoming as (select * from jsonb_populate_recordset(null::public.analytics_usage_daily, p_rows))
insert into public.analytics_usage_daily as t select * from incoming
on conflict (device_id, local_date) do update set ...
```

`jsonb_populate_recordset` yields `NULL` for any key absent from the JSON, and an explicit
`NULL` in an `INSERT` **bypasses the column default**. Every counter column is
`not null default 0`, so any row that omits a counter dies. Reproduced verbatim against local
Postgres:

```
NOTICE: CONFIRMED doc version fails: null value in column "app_opens"
        of relation "analytics_usage_daily" violates not-null constraint (SQLSTATE 23502)
```

No desktop flush will ever send all sixteen counters, so tier 2 would never have worked at
all. It also silently depends on positional column order matching the table forever.

**Fix (implemented):** explicit column list, `coalesce(i.<counter>, 0)` per counter,
`coalesce(i.platform, 'unknown')`, `coalesce(i.tz_offset_minutes, 0)`, and `now()` for
`reported_at` rather than trusting the client. Plus a `distinct on (device_id, local_date)`
CTE, because two rows for the same day in one batch make `ON CONFLICT DO UPDATE` raise
`21000 cannot affect row a second time` — and a batching desktop will do that.

### 3.2 The identity merge silently deletes identity edges

`analytics_identities.person_id` is `on delete cascade`. §8's merge is a multi-statement
read-modify-write, and both ingest endpoints are public and unauthenticated, so concurrent
calls are certain. Interleave two merges with overlapping identifier sets and each can pick a
different winner and delete the other's — cascading away the identity edges the other just
repointed. The corruption is invisible until a funnel number looks wrong months later.

**Fix (implemented):** `perform pg_advisory_xact_lock(hashtext('analytics_link'))` at the top
of the function. Full serialization is free here: `analytics_link` runs ~30 times per person
per *lifetime* (tier-2 usage rows do not call it), so there is no throughput to protect.

### 3.3 The merge would weld two real accounts together

§8 merges every person found for the supplied identifiers. Two persons each carrying a
*different* non-null `user_id` are two humans — most often two people sharing a browser or a
family machine — and merging them is unrecoverable, because events keep no `person_id` to
un-merge. `analytics_persons.user_id` is also `unique`, so the delete/update ordering can trip
the index mid-statement and throw inside `track()`, which §9 promises never throws.

**Fix (implemented):** only fold in persons whose `user_id` is null or matches the winner's.
Because `user_id` is unique, a mergeable loser always has `user_id is null`, so the promotion
at the end of the function can no longer collide.

### 3.4 One junk prop breaks the entire funnel view

`analytics_funnel` does `(e.props->>'session_index')::int`. `props` arrives from a public
unauthenticated endpoint, so a single uncastable value makes the whole view raise **for every
query against it** — one bad row takes down the funnel panel for everyone.

**Fix (implemented):** `and e.props->>'session_index' ~ '^[0-9]+$'` before the cast in the same
AND chain, plus `z.number().int().min(1).max(3)` in the event's props schema. Belt and braces,
because the endpoint is public.

### 3.5 Missing `service_role` grants

§7 only *revokes* from `anon, authenticated` and never grants to `service_role`.
`0005_public_grants.sql` exists in this repo specifically to document that recent Supabase
projects no longer grant on new public tables by default — so every ingest insert and every
dashboard read would have failed `permission denied for table analytics_events` before RLS was
ever consulted. Worse, `revoke all on function ... from public` strips `service_role`'s
implicit `PUBLIC` execute grant, so both RPCs fail too.

**Fix (implemented):** explicit `grant select, insert, update, delete` on the four tables,
`grant select` on the four views, `grant execute` on both functions, all to `service_role`.

### 3.6 Views bypass RLS without `security_invoker`

A Postgres view runs with its **owner's** privileges unless created
`with (security_invoker = on)`, so RLS on the base tables does nothing for
`analytics_events_resolved`. That is safe today only because no client grant exists — but the
day anyone adds a blanket `grant select on all tables in schema public to authenticated`, the
entire funnel leaks. §7 revokes on tables and forgets the views entirely.

**Fix (implemented):** all four views are `with (security_invoker = on)` and explicitly revoked
from `anon, authenticated`.

### 3.7 The `occurred_at` clamp contradicts the offline buffer

§7 clamps `occurred_at` to `received_at ± 24h`. §6.5 and §9.3 describe a desktop that keeps a
**35-day** offline queue precisely so a machine offline for weeks still reports accurately. A
24h clamp destroys exactly the timestamps that buffer exists to preserve.

**Fix (implemented):** the clamp is per-source. `web`/`server` keep ±24h back / +1h forward;
`desktop` gets 35 days back / +1h forward, matching the log horizon.

### 3.8 The seam cannot live at `src/lib/analytics/track.ts`

`apps/web/eslint.config.mjs` bans importing `@/lib/supabase/admin` outside an allowlist, and
`src/lib/analytics/**` is not on it. `src/server/**/*.ts` **is** (and the directory did not
exist yet).

**Fix (implemented):** the service-role seam is `apps/web/src/server/analytics/track.ts`.
`src/lib/analytics/` keeps the pure taxonomy and the client-side PostHog helpers. No ESLint
edit required. Note the allowlist covers `.ts` only — nothing under `src/server/` may be
`.tsx`, so dashboard panels live under `src/app/` and import query functions.

### 3.9 `account_created` / `signed_in` do not come from the auth callback

§10 attributes both to `api/auth/callback/route.ts`. That route only handles the OAuth `?code`
exchange. Password signup and login are **entirely client-side**:
`src/components/auth/SignupForm.tsx:29` calls `client.auth.signUp(...)` and
`src/components/auth/LoginForm.tsx:28` calls `client.auth.signInWithPassword(...)` through
`supabaseBrowser()`. Neither touches the callback.

**Fix (implemented in the seam, to be wired in Phase 2):** emit from **both** places and let the
`idempotency_key` unique index absorb the overlap. `deriveIdempotencyKey()` produces
`account_created:<user_id>` automatically for the events in `ONCE_PER_PERSON_EVENTS`, so "once
per person, ever" becomes a database guarantee rather than a call-site convention.

### 3.10 An ingest kill-switch is mandatory

`pnpm web:prod` is `sync:env --mode=prod && next dev` — a dev server pointed at the
**production** database. Without a guard, browsing localhost in that mode writes your own page
views, signups and download clicks into the production funnel the dashboard exists to report,
with no way to tell them apart afterwards.

**Fix (implemented):** `ingestAllowed()` in the seam. A non-production build may only write to
a localhost database. Consequences, all desired:

| Mode | Ingest writes | Dashboards |
|---|---|---|
| `pnpm web:dev` | local postgres (bot suite depends on this) | both |
| `pnpm web:prod` | **none** — read-only | both |
| Vercel production | production | 404 (guarded) |

### 3.11 Billing analytics must be payload-derived — IMPLEMENTED

`api/stripe/webhook/route.ts` calls `stripe.subscriptions.retrieve()` inside
`checkout.session.completed` and every `customer.subscription.*` case. A fixture event carrying
a fake `sub_…` id gets a 404 from real Stripe, the handler throws, and you get a 500 — so
signed fixture payloads could not drive a retrieve-derived implementation at all.

**Fix (implemented):** `apps/web/src/server/analytics/billing.ts`. `billingSignalsFor(event)`
is **pure** — it reads only `event.data.object` and `event.data.previous_attributes` — and
`resolveUserIdFor(event)` prefers the `metadata.user_id` that `@talysman/billing-server` stamps
onto both the subscription and the customer at checkout creation, falling back to one `profiles`
lookup by `stripe_customer_id`. No Stripe round trip on the analytics path.

`trackBillingEvent(event)` is called **before the switch**, so the analytics row lands even when
a later `retrieve` fails and the handler returns 500 for Stripe to retry. Retries are safe: the
once-per-person events carry derived idempotency keys, and `stripe_events` short-circuits a
fully-processed event before this runs.

Beyond making the bot suite possible, this is the right shape anyway: §9.1 promises analytics
never breaks a user flow, and analytics that *depends* on an outbound Stripe call fails whenever
Stripe is slow — after the money has already moved.

### 3.12 `telemetryEnabled` does not belong in `packages/shared/src/settings.ts`

§14 says add it to `Settings`. That type is **service-owned** and mirrored in Rust
`native/*/src/model.rs`; the only settings setter in the protocol is `setBrowserHandshake`. A
TS-only field would never be echoed by `getState`, and doing it properly means a three-crate
Rust change plus a new RPC — for a UI preference the privileged daemon has no business knowing.

**Fix (Phase 6):** a desktop-local `telemetry.json` next to `onboarding.json`, mode `0o600`,
same "losing it is safe" posture.

### 3.13 The bot-UA filter is a silent data destroyer

§14 says filter `page_viewed` by user-agent **before inserting**. In production an over-broad
regex then deletes real traffic invisibly and uncountably.

**Fix (Phase 1c):** insert with `props.ua_class = "bot"` and filter in the views instead, so the
decision is reversible and countable. The bot suite additionally sets a normal desktop
user-agent, since Playwright's default contains `HeadlessChrome`.

### 3.14 `TransitionKind` cannot produce `key_present_seconds`

§10 says `key_present_seconds` derives from `keyPresenceChanged` transitions "in the same log",
but §6.2 defines `TransitionKind` as only `FocusOn | FocusOff | ScheduleFired`.

**Fix (Phase 7):** add `KeyPresent` / `KeyAbsent` to the enum and all three Rust mirrors, or
drop the column. Do the former.

### 3.15 Other corrections, lower stakes

- **`Secure` on `tal_aid`** is specified unconditionally (§4.1). Mirror the existing
  `secure: process.env.NODE_ENV === "production"` from `middleware.ts` so a non-loopback dev
  host does not drop it.
- **`/insights` pollutes the funnel it displays.** It is a page on the same app, so
  `page_viewed` records every dashboard visit and the raw-stream panel shows its own traffic.
  Exclude `/insights*` from tracking, `sitemap.ts`, and `robots.ts`.
- **Retention uses exact date equality** (§11.3: `u.local_date = c.installed_on + 7`), i.e.
  "active on precisely that calendar day". For a product used a few days a week that reads as
  catastrophic churn. Use a window (`between +5 and +9`) and label it. Separately,
  `min(local_date)` as `installed_on` conflates first-*reported* day with install day, and
  §6.5 allows a week-late backfill — so a cohort assignment can move *backwards* as late rows
  arrive. Anchor on `app_installed.occurred_at` with `min(local_date)` as fallback.
- **PostgREST has no raw-SQL endpoint**, and §12.2 says panels query `supabaseAdmin()`
  directly. §11.2's stickiness query and §11.3's retention CTE are not views, so every panel
  query must be a view or a `security definer` function. For the **prod** target there is no DB
  password in `.credentials` at all, so a direct `pg` connection is not an alternative.
- **PostgREST `max_rows = 1000`** (`apps/web/supabase/config.toml`) silently truncates any
  panel that fetches rows to aggregate in JS. Aggregate in SQL; use `{ head: true, count:
  "exact" }` for counts.
- **No email in PostHog — DECIDED AND IMPLEMENTED.** Turning on the PostHog key changed
  behaviour beyond analytics: `src/app/providers.tsx` was calling
  `posthog.identify(session.user.id, { email })`, dormant while the key was a placeholder and
  live once it was real. That contradicts §14's "keep PII out of analytics", so the email is
  gone — identification is by opaque user id only. `analytics_events.user_id` joins to
  `profiles` when an address is genuinely needed, so copying one into a third-party store bought
  nothing and put PII somewhere we do not control. Session replay on the marketing site is
  still worth auditing separately before launch.

---

## Phase 1 — Foundation

### 1a. Schema — ✅ DONE

`apps/web/supabase/migrations/0006_analytics.sql`. Four tables, four views, two functions.

| Object | Purpose |
|---|---|
| `analytics_persons` | A human. First-touch attribution immutable, last-touch moves. |
| `analytics_identities` | `identifier` (`anon:`/`device:`/`user:` prefixed) → `person_id`. One text PK covers all three spaces. |
| `analytics_events` | Tier 1 milestones, raw identifiers, `idempotency_key text unique`. |
| `analytics_usage_daily` | Tier 2, PK `(device_id, local_date)`, counters cumulative for the day. |
| `analytics_events_resolved` | Base + `coalesce(user, device, anon)` → `person_id`. |
| `analytics_usage_resolved` | Same for usage. |
| `analytics_funnel` | One row per person, one timestamp column per milestone. |
| `analytics_dau` | `dau_protected` (the headline), `dau_ui`, focus hours, medians. |
| `analytics_link(text[], jsonb)` | Resolve/merge identity + record attribution. One round trip. |
| `analytics_report_usage(jsonb)` | Idempotent `greatest()` upsert. Returns rows affected. |

Deviating from §7 deliberately: attribution is folded into `analytics_link` as a second
`p_attribution jsonb` parameter rather than a separate statement, because it runs on the public
ingest hot path and one round trip beats two. First-touch columns use
`coalesce(existing, nullif(incoming, ''))` so they are written once and an empty
`?utm_source=` does not count as having earned the person; last-touch uses
`coalesce(nullif(incoming, ''), existing)` so a direct visit does not erase the last campaign.

### 1b. Types and env — ✅ DONE

- `apps/web/src/lib/supabase/types.ts` — eight new row types.
- `apps/web/src/lib/supabase/database.types.ts` — **hand-maintained** (see its header). Four
  tables, four views, two `Functions` entries, plus a new exported `Json` type matching what
  `supabase gen types` emits so a future regeneration is a clean swap.
- `apps/web/src/lib/config.ts` — `normalizeSupabaseUrl()` extracted from the inline transform
  and shared; `optionalStripped` (the `...`-placeholder rule, previously inline in
  `optionalPosthogKey`); new `optionalSupabaseProjectUrl` that tolerates absence. Five new
  server vars, **all optional defaulting to `""`** — `config.ts` throws at module load and
  these never exist on Vercel, so a required field would fail `next build` for every deploy.
  Surfaced as `config.insights.{enabled, prod:{url,secretKey}, dev:{url,secretKey}}`.
- `scripts/sync-env.ts` — the five vars appended to `localWebPairs` in `main()`, next to the
  existing `STRIPE_CLI_API_KEY` precedent. **Local-only by construction, not by policy:**
  `pushToVercel(webPairs, ...)` returns before that block, so nothing appended there can reach
  a deployment. No `SENSITIVE_VERCEL_VARIABLES` entry needed — that set governs how a *pushed*
  var is stored. Both credential blocks are read regardless of `--mode`.

### 1c. Ingest routes and `tal_aid` — ✅ DONE

**`POST /api/analytics/track`** — wraps `track()`. §14 hardening, all of it:

- zod event allowlist via `analyticsEventName` → 400 on unknown (already built)
- body cap ~8 KB; `props` ≤ 30 keys (`MAX_PROPS_KEYS`, already enforced by `parseEventProps`)
- `anon_id` read from the `tal_aid` cookie, **never** from the body
- `user_id` derived from the bearer token via the `requireBearerUser` pattern
  (`src/lib/auth/require-bearer-user.ts`); only `device_id` is client-asserted
- per-IP and per-`device_id` rate limit, generously
- bot user-agent classification → `props.ua_class`, **not** a pre-insert drop (§3.13)
- coarse device type and OS labels → `props.device_type` / `props.os`; never retain the raw UA
- attribution extracted server-side from the request: UTM query params, `Referer` host,
  paid-platform click IDs, and Vercel country headers. Never raw IPs.

**`POST /api/analytics/usage`** — wraps `reportUsage()`. Same shape plus §14's usage limits:
`focus_seconds <= 86400`, counters within `smallint`, `local_date` within ±40 days of today,
≤ 40 rows per request, 32 KB body cap.

**`tal_aid` in `src/middleware.ts`** — currently line 17 early-returns for both `asset` and
`api`. Narrow it carefully:

```ts
// Assets skip entirely. API requests need the cookie but must NOT pay for the auth +
// entitlement round trips — /api/analytics/track is the hot path for every pageview.
if (kind === "asset") return NextResponse.next();
if (kind === "api") return withAnonId(request, NextResponse.next());
```

Do **not** simply delete `api` from the condition: that runs `client.auth.getUser()` *and*
`getUserEntitlement()` on every tracked pageview, two DB round trips per event. For the
non-API kinds, set the cookie inside the existing `finish()` helper so every return path picks
it up. UUID, `Max-Age` 400 days, `SameSite=Lax`, `secure` only in production (§3.15),
deliberately **not** `httpOnly` — the client needs to read it.

Note `api/stripe/webhook` and `api/auth/callback` are excluded from the matcher outright, so
`account_created` in the callback must tolerate a missing `tal_aid`: a user whose very first
request is an OAuth callback has none.

**Tests:** allowlist rejection, body/props caps, clamping via the route, the HeadlessChrome UA
case, `anon_id` from cookie only, and `anon-id.test.ts` for the mint/parse helper.

*Verify:* `curl` a good and a bad event name, then read `analytics_events` in Studio
(`localhost:54323`).

---

## Phase 2 — Web funnel — ✅ DONE

Instrument in this order. The first is the highest-integrity signal in the whole system and is
about ten lines.

| Event | File | Notes |
|---|---|---|
| `download_clicked` | `src/app/api/desktop/download/route.ts` | Before the 302. Server-side, so it fires with an ad blocker on, with JS broken, and cannot be missed — the redirect *is* the download. |
| `page_viewed` | `src/app/providers.tsx` | Extend the existing `PostHogPageview` to dual-emit. Exclude `/insights*` (§3.15). Note `posthog.identify` here is id-only — do not reintroduce email (§3.15). |
| `signup_started` | `src/components/auth/SignupForm.tsx` | `{ method, surface }`. |
| `account_created` | `SignupForm.tsx` **and** `api/auth/callback/route.ts` (`flow=signup`) | Both, per §3.9. |
| `signed_in` | `src/components/auth/LoginForm.tsx` **and** the callback route | Both. |

Client-side emits go through a thin poster in `src/lib/analytics/posthog-client.ts` that POSTs
to `/api/analytics/track`, using `navigator.sendBeacon` for anything racing a navigation.

*Verify:* `pnpm web:dev`, browse with `?utm_source=reddit`, click a download link, sign up.
Expect four event rows and **one** person, with `first_utm_source = 'reddit'`.

---

## Phase 3 — The two dashboards — ✅ DONE

### The governing invariant

**The insights pages never touch `config.supabase.*` or `supabaseAdmin()`.** Both targets come
from the dedicated `ANALYTICS_*` credentials. If `/insights` reused `supabaseAdmin()` it would
show different data depending on which mode the server booted in — exactly what the decision in
§2 forbids.

### Client factory

`apps/web/src/server/analytics/db.ts`:

```ts
export type AnalyticsTarget = "prod" | "dev";

export type TargetResult =
  | { ok: true; db: SupabaseClient<Database>; label: string; host: string }
  | { ok: false; reason: "unconfigured" | "unreachable" | "unmigrated"; detail: string };

export function analyticsDb(target: AnalyticsTarget): SupabaseClient<Database> | null;
export const resolveTarget: (t: AnalyticsTarget) => Promise<TargetResult>; // React cache()
```

- The **client** is module-cached (a two-entry `Map`), not `cache()`d — a supabase-js client is
  not request-scoped, and one per request wastes sockets. Same posture as `admin.ts`.
- `resolveTarget` and each panel query are `cache()`d per request, keyed by target, so eight
  panels probe once.
- `createClient` throws on an empty URL, so check `config.insights[target].url` first and
  return `null`.
- Give the client a `fetch` with `AbortSignal.timeout(4000)`: a stopped local Docker stack must
  produce a message, not a 30-second hang and then a 500.
- **Never pass the client as a prop.** Panels receive `target: AnalyticsTarget` — a string.
  Passing a `SupabaseClient` from a page into a nested server component is legal today and
  lethal the day a panel gains `"use client"`: serialization error at best, service-role key in
  a client payload at worst.

The probe distinguishes three failures, because migration drift between dev and prod is the
*normal* state mid-rollout: PostgREST `PGRST205` / Postgres `42P01` → `"unmigrated"`, other
errors → `"unreachable"`, empty credentials → `"unconfigured"`.

### Routes

```
src/app/(dev)/layout.tsx              # the double guard
src/app/(dev)/insights/page.tsx       # <InsightsDashboard target="prod" />
src/app/(dev)/insights/dev/page.tsx   # <InsightsDashboard target="dev" />
```

A route group `(dev)` plus a literal nested segment — not `[target]` (which would leave
`/insights` unmatched) and not `[[...target]]` (which swallows `/insights/typo`). The group
keeps `/insights` at the top level and gives the dashboard its own layout, outside the
marketing chrome.

```tsx
export default function DevLayout({ children }: { children: React.ReactNode }) {
  // Vercel builds run with NODE_ENV=production, so this 404s there regardless of env.
  if (process.env.NODE_ENV === "production") notFound();
  if (!config.insights.enabled) notFound();
  return <div className="insights-root">{children}</div>;
}
```

Read the second guard through `config.insights.enabled`, not `process.env` directly, so the
repo's "never read `process.env` outside `config.ts`" rule holds. `NODE_ENV` stays a direct
read — that is already the idiom in `middleware.ts` and `DevBadge.tsx`.

`export const dynamic = "force-dynamic"` goes on each **page**, not the layout, or `next dev`
serves stale numbers and the bot suite's assertions go flaky.

**Rule: no `route.ts` anywhere under `(dev)`.** A layout guard does not protect a sibling route
handler.

### Panels

```
src/components/insights/
  InsightsDashboard.tsx   TargetBanner.tsx   PanelShell.tsx
  Unavailable.tsx         MigrationStatePanel.tsx
  FunnelPanel.tsx  ChannelTablePanel.tsx  ActiveUsersPanel.tsx  EngagementPanel.tsx
  RetentionPanel.tsx  InstallHealthPanel.tsx  RevenuePanel.tsx  RawStreamPanel.tsx
```

Every panel is `async function Panel({ target }: { target: AnalyticsTarget })` calling a query
in `src/server/analytics/queries/`. Every query returns a **discriminated union and never
throws**:

```ts
type PanelData<T> = { ok: true; rows: T } | { ok: false; message: string };
```

That is what turns "credentials absent", "local Docker stopped" and "this target has not run
0006 yet" into three different readable sentences in one panel while the other seven keep
working. Wrap each in `<Suspense>` so eight sequential round trips stream rather than block.

`MigrationStatePanel` does `head: true` counts against each expected relation and lists
present/absent. It answers "why is this panel empty" instantly, and costs ten lines.

Build **`RawStreamPanel` first** — last 200 events and 50 usage rows with identifiers and
props. Unglamorous, and the thing you will actually use while building every later phase.

Add the remaining views to a `0007_analytics_views.sql`: `analytics_channel_funnel`,
`analytics_retention_cohorts` (windowed, per §3.15), `analytics_install_health`,
`analytics_engagement_daily`.

### DEV labelling

The banner lives in `InsightsDashboard` (which knows the target), not the layout (which does
not):

- `<main data-insights-target="dev">` — a stable hook for E2E assertions, separate from styling
- `.insights-banner--dev`: full-width sticky amber/red strip,
  `LOCAL DEV DATABASE — 127.0.0.1:54321`. Reuse the visual idiom of the existing `.dev-badge`
  rule in `src/app/globals.css`
- `.insights-banner--prod`: dim, `PRODUCTION DATABASE — <host>`
- `export const metadata = { title: "Insights (DEV)" }` per page — you will have both tabs open
  simultaneously, and the tab title is what you actually look at
- each dashboard links to the other

Also: exclude `/insights` from `robots.ts` and `sitemap.ts`, and change the `prod` script to
`next dev -H 127.0.0.1` so the production-data dashboard is not served to the LAN.

*Verify:* `pnpm web:dev` → both URLs render different datasets. Stop local Supabase →
`/insights/dev` shows "not running" while `/insights` still works. Blank the prod vars →
"unconfigured". Then `pnpm web:prod` and confirm both URLs still work.

---

## Phase 4 — Billing

### Webhook events — ✅ DONE

`apps/web/src/server/analytics/billing.ts` (new), wired into
`src/app/api/stripe/webhook/route.ts` with a single `await trackBillingEvent(event)` before the
`switch`. Payload-derived throughout, per §3.11.

Two exported pieces, split so the mapping is testable without mocks:

```ts
export function billingSignalsFor(event: Stripe.Event): BillingSignal[]   // pure
export async function trackBillingEvent(event: Stripe.Event): Promise<void>  // never throws
```

`billingSignalsFor` returns an **array** because one `customer.subscription.updated` can mean
two things at once (a trial converting *and* being set to cancel).

| Stripe event | Emits | Condition |
|---|---|---|
| `customer.subscription.created` | `trial_started` | `status === 'trialing'` or `trial_end` set |
| `customer.subscription.created` | `subscription_started` | otherwise |
| `customer.subscription.updated` | `subscription_started` | `previous.status === 'trialing'` → `active` (the trial converting) |
| `customer.subscription.updated` | `subscription_canceled` | `cancel_at_period_end` flipped `false` → `true` — **intent**, not access loss |
| `customer.subscription.deleted` | `subscription_ended` | access has actually lapsed |
| `invoice.payment_succeeded` | `subscription_renewed` | `billing_reason === 'subscription_cycle'` only |
| `invoice.payment_failed` | `payment_failed` | with `attempt` from `attempt_count` |
| `charge.refunded` | `refund_issued` | |
| `checkout.session.completed` | *nothing* | `customer.subscription.created` covers the same conversion with better data; emitting both would double count |
| `customer.subscription.{paused,resumed,trial_will_end}` | *nothing* | not in the taxonomy |

The behavioural change: `relevantEvents` gains `invoice.payment_succeeded`. Renewals were
previously invisible — `customer.subscription.updated` fires on renewal but does not tell you a
payment cleared. It is **analytics-only**: there is deliberately no `case` for it in the switch,
so it sends no email and syncs nothing, and a test asserts exactly that. `subscription_renewed`
fires only for `subscription_cycle`, which excludes the initial `subscription_create` invoice so
signup is not double-counted as a day-one renewal.

Identity resolution ordering matters and is not obvious: `billing-server` sets
`profiles.stripe_customer_id` at **checkout creation**, not during `syncSubscription`, so the
profile already carries it by the time any webhook fires. Tracking before the sync therefore
resolves `user_id` correctly. `metadata.user_id` (also stamped at checkout) means the common
case needs no database read at all.

Tests: `tests/unit/analytics-billing.test.ts` (22 tests, exhaustive over the mapping table
above), three new cases in `tests/unit/stripe-webhook-route.test.ts` (renewal emits without
emailing or syncing; `subscription_create` is not a renewal; the analytics row survives a 500),
and `tests/integration/stripe-webhook-cli.test.ts` now records analytics rows from **real**
Stripe CLI deliveries and asserts every row is `source: "server"`, carries a resolved
`user_id`, and names only a taxonomy billing event. That last one is the only place the mapping
meets payloads Stripe actually sends rather than hand-written fixtures.

### Remaining — ⬜ TODO

`checkout_started` from `api/stripe/checkout/route.ts` and `api/desktop/checkout/route.ts`;
`comp_code_redeemed` from `api/comp/redeem/route.ts` and `api/desktop/comp/redeem/route.ts`.
Both are ordinary `track()` calls at the route level, not part of the webhook mapping.

---

## Phase 5 — The bot E2E suite

Landed here, not at the end, for three reasons: everything through Phase 4 is now assertable;
the suite becomes the regression net for Phases 6–8 as they land; and its fake-desktop helper
**is the wire-format spec for the desktop client written in Phase 6**.

### Layout

```
apps/web/playwright.bots.config.ts
apps/web/tests/support/playwright-env.ts     # loadEnvLocal + CHROME_PATH, extracted
apps/web/tests/bots/
  global-setup.ts   personas.ts
  helpers/{guard,db,signing,desktop,dashboard}.ts
  fixtures/stripe-events.ts
  seed.spec.ts   dev-dashboard.spec.ts
```

A **separate config file**, not a second project in `playwright.config.ts`: a second project
runs under `pnpm web:test:e2e` unless every invocation passes `--project`, which enforces "not
part of the normal test list" by convention instead of by structure.

Scripts: `test:bots` in `apps/web/package.json`, `web:test:bots` at the root. Add a **"Rarely
run"** subsection to `README.md` making clear it is *not* part of the pre-commit list at lines
85–101.

Extract `loadEnvLocal()` and the NixOS `CHROME_PATH` escape hatch from
`apps/web/playwright.config.ts` into `tests/support/playwright-env.ts` and import from both.

Key config settings, each for a reason:

```ts
testDir: "./tests/bots",
fullyParallel: false, workers: 1,
retries: 0,        // a retry re-posts events and corrupts exact counts. Hard zero.
timeout: 120_000,
globalSetup: "./tests/bots/global-setup.ts",
use: {
  // MANDATORY: Playwright's Chromium UA contains "HeadlessChrome". Without this, every
  // bot page_viewed is classified ua_class=bot and filtered out of the views.
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
},
webServer: { command: "pnpm dev", url: `${BASE_URL}/insights/dev`, reuseExistingServer: true },
```

Waiting on `/insights/dev` rather than `/` proves the guard env reached the server process
before a single persona runs. `reuseExistingServer: true` unconditionally — never let the suite
run `sync:env` and clobber a developer's `--mode=prod` sync.

### Guard and reset

`helpers/guard.ts` — four conditions, all must hold before any delete:

```ts
const LOCAL = new Set(["localhost", "127.0.0.1", "::1"]);
export function assertLocalTarget(url: string, secret: string, prodSecret: string) {
  const u = new URL(url);
  if (!LOCAL.has(u.hostname)) throw new Error(`Refusing to truncate: host is ${u.hostname}`);
  if (u.port !== "54321")     throw new Error(`Refusing to truncate: port is ${u.port}`);
  if (secret === prodSecret)  throw new Error("Refusing: dev and prod secret keys match");
  if (process.env.CI === "true") throw new Error("The bot suite is never a CI gate");
}
```

It guards `ANALYTICS_DEV_SUPABASE_URL`, **not** `NEXT_PUBLIC_SUPABASE_URL`, so the suite behaves
identically whichever mode the developer last synced. **Unit-test it** in
`apps/web/tests/unit/` with an `https://abc.supabase.co` case — a guard that only executes
during a rarely-run suite is a guard nobody knows is broken.

Truncation mechanics: PostgREST cannot `TRUNCATE` and refuses unfiltered `DELETE`. Delete
through PostgREST with explicit always-true filters, FK-safe order:
`analytics_events` → `analytics_usage_daily` → `analytics_identities` → `analytics_persons`,
then `stripe_events` where `id like 'evt_bot_%'`, then the `bot-` prefixed
`profiles`/`subscriptions`/`comp_codes`/`auth.users`.

> **The `stripe_events` cleanup is the single most likely first-run-passes / second-run-fails
> bug in the whole suite.** The webhook dedupes on that table, so a second run's fixture events
> are swallowed and every billing count reads zero. Belt and braces: also make fixture event
> ids unique per run (`evt_bot_${runId}_${n}`).

`global-setup.ts` then runs a **canary**, because `/api/health` cannot tell you which database
the server is bound to: POST one event through the running dev server, poll the *local* DB for
it (5s budget), and on absence fail with *"The dev server is not writing to local Supabase.
Start it with `pnpm web:dev` (not `web:prod`)."* Delete the canary. One step validates local
liveness, the ingest route, and the mode binding.

### Personas

Declarative records, not functions, so expected counts derive from the same source of truth as
the actions. Fixed device ids (`00000000-0000-4000-8000-00000000000N`) and fixed emails
(`bot-p4@talysman.test`, no `Date.now()`) — with truncate + user cleanup that is correct, and a
failed teardown then fails the *next* run loudly instead of leaking users silently.

| # | Persona | Shape | Proves |
|---|---|---|---|
| 1 | `bounce` | one visit, `utm_source=reddit` | `page_viewed`, first-touch, anon-only person |
| 2 | `downloader` | visit (`utm_source=hn`) → `/download` → download | the server-side 302 signal |
| 3 | `installer-anon` | 2 + `app_installed` + `service_install_failed` + `usb_pair_failed` | install-health panel, device with no user |
| 4 | `activated` | visit (google/cpc) → download → real signup → install → service_installed → extension_connected → pair → schedule → 3 sessions → usage at day offsets 0,1,2,7,30 | the full anon+device+user identity bridge, activation, retention |
| 5 | `payer` | 4-lite + checkout → trial → subscribe → renew | billing chain, trial-to-paid, revenue panel |
| 6 | `churner-comped` | signup → subscribe → payment_failed → cancel → ended → comp redeem → uninstall | churn intent vs ended, involuntary churn |

### Real channel per event

| Event | Channel |
|---|---|
| `page_viewed` | real `page.goto("/?utm_source=…")`; await with `page.waitForResponse(r => r.url().includes("/api/analytics/track"))` — deterministic, no polling |
| `tal_aid` | read back via `context.cookies()`; middleware minting it is the thing under test |
| `download_clicked` | `context.request.get("/api/desktop/download?platform=win", { maxRedirects: 0 })`, assert 302. **Must be `context.request`** — only that shares the cookie jar, and the cookie is the whole point |
| signup / signin | real form fill against local Supabase; `config.toml` has `enable_confirmations = false`, so no inbox step |
| billing | `Stripe.webhooks.generateTestHeaderString({ payload, secret })`, POSTed as **the exact same string** (`data: payloadString`, never an object, or the HMAC breaks). Import `Stripe` directly — `@/lib/stripe/client` is `server-only` and Playwright has no shim alias |
| `comp_code_redeemed` | real: admin-insert a `comp_codes` row, drive `/redeem/<code>` — the `redeem.spec.ts` pattern |
| desktop + usage | `helpers/desktop.ts` POSTs to the real `/api/analytics/track` and `/api/analytics/usage` with fixed device ids, plus a replayed batch to prove the `greatest()` upsert is a no-op |

### The Electron decision

The bot suite uses the **HTTP fake**, and the real Electron path is tested separately. Why:

1. The existing electron E2E runs with `TALYSMAN_USE_MOCK_SERVICE=true`, so `drainUsage` would
   hit `MockServiceConnection`, not Rust — driving Electron buys nothing *for the analytics
   tables* over the fake.
2. `API_BASE_URL` is injected at **build** time (`main/config.ts` reads `__APP_CONFIG__`), so
   pointing a packaged main process at `localhost:3000` needs an `electron-vite build` inside a
   web-scoped Playwright config.
3. Determinism: an Electron launch emits `app_installed`, window-show `app_opens` and possibly
   `service_install_*` on a schedule you do not control. Exact-count assertions go flaky.

Split honestly instead: bot suite = "does the data land, resolve and render"; a new
`tests/electron/e2e/analytics-usage.spec.ts` in the existing root suite = "does the desktop
produce the right payload" (assert against the queue file in the throwaway `userData` dir from
`tests/electron/e2e/launch.ts` — no network needed); `rollupUsage` vitest units = "is the math
right".

### Assertions

Both layers, because they catch different bugs.

`seed.spec.ts` (`describe.serial`, one test per persona so a failure names the persona) asserts
against the **DB** with `expect.poll`: per-event counts, person count, identity-edge count,
usage rows, `analytics_funnel` shapes. The most valuable single assertion: **the set of distinct
`event` values in the DB equals the zod enum minus a documented `NOT_COVERED` list** — it fails
the day someone adds an event name and forgets to instrument it. Derive expected counts from
`PERSONAS` (`countExpected(PERSONAS, "download_clicked")`), never literals, but *also* assert
~4 hardcoded headline numbers, because a derivation bug yielding zero would otherwise match a
pipeline that also yields zero.

`dev-dashboard.spec.ts` asserts **rendered HTML**, but only against explicit contract nodes —
`<span data-testid="funnel-step-download_clicked" data-count="2">` — never regexes over prose,
which makes the dashboard un-refactorable. Three assertions matter more than the counts:

1. `/insights/dev` has `[data-insights-target="dev"]` and the loud banner.
2. `/insights` has `[data-insights-target="prod"]` and either an `Unavailable` panel or a count
   **different** from dev. *This is the assertion that catches the most likely Phase-3 bug:
   both routes accidentally resolving to the same client.*
3. Re-run the count assertions **after** visiting the dashboard and confirm they are unchanged
   — proving `/insights*` is excluded from `page_viewed` (§3.15).

### Determinism notes

- Pin `RUN_TODAY` once at run start; every usage row is `RUN_TODAY - dayOffset`. §14 validates
  `local_date` within ±40 days, so **all backdating must be ≤ 40 days** — which caps the
  retention story at D30, exactly enough.
- **Milestones cannot be backdated at all** — `occurred_at` is clamped at ingest. So install
  cohorts are necessarily driven by `analytics_usage_daily`, which matches §11.3.
- `date_trunc('week', installed_on)` splits personas across two rows when a run lands near a
  week boundary. Assert cohort **sums**, not per-week rows. This costs an afternoon if
  unplanned.
- Serial execution, no parallel personas: beyond flake, concurrent `analytics_link` calls now
  serialize on an advisory lock anyway (§3.2).

Runtime budget: ~60–120s cold, ~30–45s warm, dominated by `next dev` first-compiling each
route. Over 3 minutes means a stale `.next`.

---

## Phase 6 — Desktop milestones and approximate usage

**`apps/desktop/src/main/analytics.ts`** (new):

- `device_id` persisted next to `onboarding.json` using the exact pattern in
  `main/onboarding.ts`: `app.getPath('userData')`, `mode: 0o600`, in-memory cache, try/catch
  that degrades gracefully.
- NDJSON offline queue capped at 5,000 events / 2 MB, oldest dropped. **Offline buffering is
  not optional** — this is a blocker app, run precisely when network access is restricted.
- Flush on launch, on a 15-minute timer while open, and on `before-quit` (note
  `window-all-closed` calls `app.quit()`, and enforcement outlives the UI).
- `Authorization: Bearer` from `main/auth/session.ts` when signed in.
- Endpoint from `MainConfig.apiBaseUrl` (`main/config.ts`) — nothing in main reads
  `process.env` directly.
- Init in `bootstrap()` in `main/index.ts`, after `connectService()`.

Milestones and their origins: `app_installed` (first run = absence of the `device_id` file);
`service_install_*` from `main/service/installer.ts`; `onboarding_*` from `main/onboarding.ts`
and the renderer walkthrough; `usb_key_paired` / `usb_pair_failed` / `schedule_created` from
the `pairKey` and `setSchedule` handlers in `main/ipc/handlers.ts`; `extension_connected`
derived from the existing `extensionHeartbeat` subscription — **the extension itself must not
phone home** (§9.4: no new host permissions, nothing to justify in a Chrome Web Store review,
and it proves the extension is *working* rather than merely installed); first three
`focus_session_completed` per device from a `focusChanged` subscription gated on a local
lifetime counter.

Approximate usage: accumulate `app_opens` (from `main/window.ts` `ready-to-show` /
`showMainWindow`), toggle counts, and *observed* focus seconds. `focus_seconds` is
**undercounted** here — badge it provisional in the engagement panel. An undercount you
understand beats no data for another month.

> **Careful:** `main/service/client.ts` re-issues `getState` and synthesizes a `stateChanged`
> on every reconnect, so observed-focus tracking must not double-count reconnect snapshots.

Privacy: `telemetry.json` per §3.12, default on, with a visible toggle and plain-language copy
stating the daily row contains counts and durations only. Add the product-analytics paragraph
to the privacy policy in the same commit — opt-out with honest disclosure is the defensible
position, and being able to point at the "counts and durations only" guarantee is what makes it
defensible.

Test: `tests/electron/unit/analytics-queue.test.ts` for the 5,000-event / 2 MB cap.

---

## Phase 7 — Exact usage: the Rust transition log

`native/{linux,macos,windows}/src/state.rs` and `model.rs` are **byte-identical** across all
three crates, so this is the same small diff three times.

1. **`model.rs`** — `UsageTransition { seq: u64, at: u64, kind: TransitionKind, source:
   FocusSource }` and `TransitionKind { FocusOn, FocusOff, ScheduleFired, KeyPresent, KeyAbsent }`
   (the last two per §3.14), both `#[serde(rename_all = "camelCase")]`. `FocusSource` already
   exists at `model.rs:126`.
2. **`state.rs`** — `#[serde(default)] pub usage_log: Vec<UsageTransition>` and
   `#[serde(default)] pub usage_seq: u64`. **`Default` is hand-written, not derived** — a new
   field must be added there too or it will not compile in any of the three crates. Prune in
   `migrate()` to 2,000 entries / 35 days, whichever binds first, so a file that grew while a
   client was gone is bounded at load. Extend the existing `#[cfg(test)] mod migration_tests`.
3. **Make `save()` atomic in the same change.** Today it is a plain `fs::write` (truncate in
   place, no temp+rename, no fsync) and `load()` does `unwrap_or_default()` on a parse error —
   so a torn write silently resets **profiles, paired keys and focus state**. A 2,000-entry log
   takes the file from ~2 KB to 100–200 KB and multiplies that window. Required: write
   `state.json.tmp` + `sync_all()` + `fs::rename`; do not save on every transition (append in
   memory, flush on the existing cadence); replace `unwrap_or_default()` with log + `.bak`
   recovery, because "silently forget every paired key" is the worst possible failure for this
   product. **This is the highest-severity item in the plan and the design doc does not mention
   it.**
4. **`core.rs`** — `fn record_transition(&mut self, kind, source)` called from `set_focus`
   (`core.rs:136`), the single write site for `focus_active`, which therefore covers
   `enableFocus` / `disableFocus` / `schedule_tick` / `rearm_on_boot` / `recover` and the
   `focus_cli` binaries. Also record presence from `recompute_presence` (`core.rs:122`). Add one
   `"drainUsage" => { ... }` arm to `dispatch` using the existing `parse_field` helper
   (`listRemovableDrives` is the closest template). `dispatch` is synchronous and holds the
   `tokio::sync::Mutex` — no I/O beyond the existing `state.save()`.
5. **`packages/shared/src/protocol.ts`** — `drainUsage: { params: { afterSeq: number }; result:
   { transitions: UsageTransition[]; latestSeq: number } }`. No ack round trip: the client
   persists `lastSeq` and asks for `> lastSeq`; re-reads after a crash are harmless because the
   queue dedupes on `idempotency_key`. **Do not touch `PROTOCOL_VERSION`** (see Hazards).
6. **`native/protocol/schema.json`** — mirror the method and the type.
7. **`apps/desktop/src/main/service/mockService.ts`** — a `case 'drainUsage':`. Its `default`
   throws `BAD_REQUEST`, so without one, `pnpm dev:mock`, `dev:desktop:mock`, `capture:*` and
   `test:electron:e2e` all silently take the fallback path and you cannot see the feature you
   are building. Add a `devPushUsageTransition()` affordance alongside the existing
   `devToggleKey()` so the mock can drive the rollup. Check
   `tests/electron/unit/mockService.test.ts` for a coverage assertion needing an update.
8. **`packages/core/src/usageRollup.ts`** — pure `rollupUsage(transitions, appOpens,
   tzOffsetMinutes): DailyUsage[]`, modelled on `scheduleEngine.ts` (clock passed in, no
   Electron/native imports). Pairs `FocusOn`→`FocusOff`; **splits intervals at local midnight**
   (a 10pm–6am window contributes 2h to one day and 6h to the next, not 8h to the start day);
   buckets by device-local date; treats a trailing unterminated `FocusOn` as still-on. Export
   from `packages/core/src/index.ts` — the barrel is explicit (`browser.ts` is deliberately
   absent), so a new file needs a line. **Enforce the privacy guarantee at the type level:**
   `DailyUsage` has no string fields other than `platform` and `app_version`, so the rollup
   cannot regress into carrying domains or app names.
9. **`main/analytics.ts`** — switch from observed to drained transitions, with the `BAD_REQUEST`
   fallback cached per session (`drainUsageSupported?: boolean`) so it does not re-probe every
   15 minutes. Only days that changed are sent.

Tests: `tests/electron/unit/usageRollup.test.ts` for midnight splitting, an unterminated
`FocusOn`, and a clock that jumps backwards. `cargo test` in `native/common`, `native/linux`,
`native/macos` — the `windows` crate can only be tested on Windows, so verify its identical
diff by inspection.

---

## Phase 8 — Polish

`app_uninstalled` (NSIS / `.deb` postrm), onboarding step-level events, retention and
install-health panel refinement, shrink the bot suite's `NOT_COVERED` list. Monthly compaction
(§13) stays **unbuilt but documented** — not needed until `analytics_usage_daily` passes ~5M
rows; partitioning not before ~20M. Flip `analytics-arch.md`'s status from *design* and fold in
every correction from §3.

---

## Verification

```bash
# Local stack
supabase start --workdir apps/web
supabase db reset --workdir apps/web      # applies 0006_analytics.sql
pnpm sync:env                              # writes BOTH analytics credential sets

# The pre-commit gate (README lines 85-101) — all must stay green
pnpm typecheck && pnpm lint && pnpm test && pnpm web:test
pnpm --filter @talysman/web typecheck
cargo test --locked --manifest-path native/common/Cargo.toml
cargo test --locked --manifest-path native/linux/Cargo.toml
cargo test --locked --manifest-path native/macos/Cargo.toml

# SQL contract tests (needs the local stack)
pnpm web:test:webhook          # includes tests/integration/analytics-sql.test.ts

# The bot suite — run deliberately, NOT per commit
pnpm web:dev                   # terminal 1
pnpm web:test:bots             # terminal 2
```

Then open `localhost:3000/insights/dev` by hand and confirm: the DEV banner is unmistakable;
the funnel narrows from 6 persons to 1 paid; the channel table splits reddit / hn / google /
direct; the raw stream shows events with identifiers; DAU and retention cohorts are non-empty
from the backdated rows; revenue shows one trial, one conversion, one cancel.

**Dual-target check.** Under `pnpm web:dev`, `/insights` shows production and `/insights/dev`
shows bot data. Under `pnpm web:prod`, both URLs still work and still show two different
datasets. Then confirm the kill-switch: browse the site under `pnpm web:prod` and verify **no**
new rows land in production `analytics_events`.

**Guard check.** Both URLs 404 with `ANALYTICS_DASHBOARD` unset, and no `ANALYTICS_*` var
appears in `vercel env ls`.

---

## Hazards

- **`database.types.ts` is hand-maintained** and must be extended *before* any
  `.from("analytics_events")` compiles, and again in Phases 3 and 7 for new views. The symptom
  when forgotten is the unhelpful *"not assignable to type `never`"*.
- **Do NOT bump `PROTOCOL_VERSION`** (`packages/shared/src/constants.ts`,
  `native/*/src/constants.rs`, both `2`). `main/index.ts:51` throws on any mismatch and
  `bootstrap()` catches and calls `app.quit()` — so a bump makes every already-installed
  service refuse to launch the app, **before** `ensureServiceCurrent()` gets a chance to
  upgrade it. `drainUsage` is additive; an old service answers `BAD_REQUEST` from `dispatch`'s
  `other =>` arm and the desktop falls back.
- **Do not narrow the middleware `api` early return into a fall-through** — that adds
  `getUser()` + `getUserEntitlement()` to every tracked pageview.
- **PostgREST schema cache**: right after `supabase migration up`, the dashboard may report a
  missing relation until PostgREST reloads (`NOTIFY pgrst, 'reload schema'`, or restart the
  stack). Do not debug the client factory over this.
- **`supabase db reset`** wipes local data, including hand-made test rows.
- **Migration numbering** — `0006` is taken; renumber if another branch claims it.
- **Playwright specs cannot import `server-only` modules.** `apps/web/vitest.config.ts` aliases
  `server-only` to a shim; Playwright has no such alias. Keep the event taxonomy pure (it is),
  and `import Stripe from "stripe"` directly in the signing helper. Follow `redeem.spec.ts`'s
  relative-import convention rather than the `@/` alias.
