# Analytics, Funnel & Usage Architecture

> Cross-surface analytics for Talysman: web (Next.js), desktop (Electron), privileged service,
> browser extension, and Stripe. A small identity graph stitches people across visits and devices;
> a two-tier storage model keeps lifetime milestones as raw events and daily engagement as
> pre-aggregated rollups. Two dev-only dashboard routes read production and local Supabase from
> `localhost:3000`.
>
> Status: **implemented through Phase 4**. See `analytics-plan.md` for the corrected runnable
> design and remaining Phases 5–8.

---

## Table of contents

1. [The problem, stated honestly](#1-the-problem-stated-honestly)
2. [Two tiers: milestones vs usage](#2-two-tiers-milestones-vs-usage)
3. [Two stores, one seam](#3-two-stores-one-seam)
4. [Identity: following a person across visits and devices](#4-identity-following-a-person-across-visits-and-devices)
5. [Event taxonomy (tier 1)](#5-event-taxonomy-tier-1)
6. [Usage telemetry (tier 2)](#6-usage-telemetry-tier-2)
7. [Schema](#7-schema)
8. [Identity resolution](#8-identity-resolution)
9. [Ingest paths](#9-ingest-paths)
10. [Where each signal originates (file by file)](#10-where-each-signal-originates-file-by-file)
11. [Queries](#11-queries)
12. [The dashboard](#12-the-dashboard)
13. [Volume, retention, compaction](#13-volume-retention-compaction)
14. [Hardening, privacy, ops](#14-hardening-privacy-ops)
15. [Build order](#15-build-order)

---

## 1. The problem, stated honestly

Most SaaS funnels live entirely in a browser, so one cookie answers everything. Ours does not.
The interesting half of the Talysman funnel happens **after the browser is gone**: the installer
runs, a privileged service asks for admin rights, a USB key gets paired, focus sessions happen on a
desktop that is frequently offline — and the blocker keeps running when the UI is closed.

That produces three separate identifier spaces:

| Space | Identifier | Lives in | Exists from |
|---|---|---|---|
| Web visitor | `anon_id` | first-party cookie | first page view |
| Desktop install | `device_id` | `app.getPath('userData')` | first app launch |
| Account | `user_id` | Supabase `auth.users` | account creation |

Most of the design below is about **joining those three**. Everything else — tables, endpoints,
dashboards — is easy once identity is settled.

**What is exactly measurable:** everything from account creation onward, and everything within a
single surface. Landing → download click is exact. Install → pair → session → trial → paid is
exact per device, and exact per person once signed in.

**What is best-effort:** the download-click → installation-completed hop, for a person who installs
but never signs in. A browser cookie cannot ride inside a `.exe`. We bridge it two ways (§4.3) —
exactly for anyone who later signs in or opens a browser from the app, and in aggregate for the
rest. Be suspicious of any analytics vendor claiming otherwise for a downloaded binary.

---

## 2. Two tiers: milestones vs usage

The funnel and the engagement question want opposite storage shapes, and conflating them is what
produces the millions of rows you want to avoid.

**Tier 1 — milestone events.** Things that happen **once per person, ever**: viewed the landing
page, clicked download, created an account, paired a key, started a trial, subscribed, churned.
There are perhaps 30 of these per person over a lifetime. Store them raw, one row each, with full
attribution. Row count grows with *people*, not with *time*, and stays trivially small.

**Tier 2 — usage telemetry.** Things that happen **every day, forever**: app opens, focus toggles,
session durations. A single engaged user generates ~15 of these per day, which is ~5,500 rows per
user per year. That is the shape that turns into 50M rows and a database you stop wanting to query.

So don't store tier 2 as events at all. **The desktop aggregates locally and uploads one row per
device per day.** You get exact daily active users, exact focus-hours, exact toggle counts and
session lengths — at 1/15th the rows and roughly 1/50th the bytes (§13), with no loss of any
metric you would actually put on a dashboard.

The bridge between the tiers: **the first three focus sessions on a device also emit raw tier-1
events.** That is exactly enough to compute the "first session / second session" funnel steps you
asked for, while steady-state usage stays aggregated. Milestones are raw; repetition is counted.

```
  tier 1  ──►  analytics_events        one row per milestone per person     ~30 rows/person/lifetime
  tier 2  ──►  analytics_usage_daily   one row per device per day           ~365 rows/device/year
```

---

## 3. Two stores, one seam

You already have PostHog scaffolded (`apps/web/src/lib/analytics/`, `providers.tsx`) but keyless,
so it currently no-ops. Now there is a project key. Use both, for different jobs:

| | Supabase | PostHog |
|---|---|---|
| Role | **System of record** | Exploration & session replay |
| Strength | Joins to `profiles`, `subscriptions`, `entitlement_grants` in plain SQL | Funnels/retention/replay with zero UI to build |
| Desktop & usage data | First-class (offline buffer, daily rollups, exact device identity) | Poor fit — rollups aren't events, and per-event pricing punishes usage data |
| Cost | Rows in a database you already pay for | Event-volume pricing |
| Risk | You build the dashboard | Vendor owns your funnel truth |

The decisive argument for Supabase-as-truth: **your revenue data is already in Postgres.** "What
did trial-to-paid conversion look like for people who came from Reddit and paired a key on day one"
is a two-join SQL query locally, and awkward-to-impossible in PostHog without piping subscription
state back out. Tier-2 rollups seal it — they are not events and do not belong in an event tool.

The argument for keeping PostHog: session replay and ad-hoc funnels on the *marketing site* cost
zero engineering, and the provider is already wired.

**So: one `track()` seam that fans out.** Every call site writes once. The seam does the Supabase
insert (authoritative) and fires PostHog (best-effort, never blocks, never throws). Send **tier 1
web events** to both; keep tier 2 and desktop events in Supabase only. If you later drop PostHog,
you delete one function body and lose nothing.

> `phc_A7HRSQgkac5ZUtyLThQ5sk2qLvU2rbmZmHQUnuXRTRws` is a PostHog *public project* key — designed
> to ship in client bundles, not a secret. Set it as `key` under the existing `[posthog]` section
> in `.credentials`, then `pnpm sync:env`. `NEXT_PUBLIC_POSTHOG_KEY` is already plumbed through
> `scripts/sync-env.ts` and `apps/web/src/lib/config.ts`; `config.ts` strips any value containing
> `...`, which is why the placeholder disables it today.

---

## 4. Identity: following a person across visits and devices

### 4.1 The three identifiers

**`anon_id`** — UUID in a first-party cookie `tal_aid`, set server-side in middleware, `Max-Age`
400 days (Chrome's cap), `SameSite=Lax`, `Secure` in production, **not** `httpOnly`. Not httpOnly on purpose: we
want client JS to hand the same id to PostHog so both stores agree on who is who. It is an opaque
analytics id, not a credential — nothing is authorized by holding it.

Set it in `src/middleware.ts`. Note the current early-return:

```ts
if (kind === "asset" || kind === "api") return NextResponse.next();
```

The download route is an API route, and it is the single most important attribution point we have,
so anon-id assignment must happen **before** that return (skip `asset` only).

**`device_id`** — UUID generated on first desktop launch, written next to `onboarding.json` in
`app.getPath('userData')` with mode `0o600`. Same "losing it is safe" posture as
`apps/desktop/src/main/onboarding.ts`: worst case a reinstall looks like a new device, which is the
honest direction to be wrong in.

**`user_id`** — Supabase `auth.users.id`. Authoritative, arrives at account creation.

### 4.2 The identity graph

Rather than trying to pick one canonical id, store the edges. `analytics_identities` maps every
identifier to a `person_id`; `analytics_persons` holds per-person attributes (first-touch
attribution, first seen).

Crucially, **events store raw identifiers, not `person_id`**. Resolution happens in a view at query
time. This is the single biggest simplification available: when two identities merge later, all
historical events follow automatically because nothing was denormalized onto them. No backfill, no
rewrite, no drift.

The cost is one three-way left join per query. At your volume — realistically under ten million
rows for years — that is free. If you ever outgrow it, materialize `person_id` then; the rows
already carry everything needed to do so.

### 4.3 The bridges

**Web ↔ account (exact).** At signup and login the browser has the `tal_aid` cookie and the server
knows the new `user_id`. Link them. This is the one that matters most, and it is exact.

**Desktop ↔ account (exact).** Once signed in, desktop uploads carry both `device_id` and
`user_id`. Link them.

**Web ↔ desktop (exact, for most people).** The desktop already opens the *system browser* for
Google OAuth, Stripe Checkout, and the billing portal — `signInGoogle`, `startCheckout`,
`openBillingPortal` in `apps/desktop/src/main/ipc/channels.ts`, all landing on our own domain under
`/api/desktop/*`. Have the desktop append `?d=<device_id>` to those URLs. That request arrives with
the `tal_aid` cookie **and** the `device_id` in the query string — both identifiers, one request,
one link row. Anyone who signs in or subscribes from the app is bridged exactly.

**Download → install (aggregate only).** For someone who installs and never signs in, there is no
exact link. Estimate the rate instead: `download_clicked` and `app_installed` both carry `platform`
and a coarse geo bucket, so a same-day join gives you a *rate*, not a person. Report it as
"download→install ≈ N%" and never as a per-person path. This is the one number in the funnel that
is a model rather than a measurement, and the dashboard must label it as such.

---

## 5. Event taxonomy (tier 1)

Naming: `snake_case`, `object_verb_past`. Events are things that *happened*; anything derivable is
a query, not an event.

### 5.1 Three changes to the original list

**"First session started / completed" and "second session completed" should not be standalone
events.** Emit `focus_session_completed` for the **first three sessions on a device only**, and
derive the ordinal in SQL with `row_number()`. Everything beyond that lives in the daily rollup.
Reasons: an offline desktop flushes out of order, so "first" computed on the client is wrong; a
person with two machines has two "first sessions" that are really one; and the moment you want
"sessions in week one" you would need yet another event. As a query, every ordinal is free — and
capping at three keeps a recurring behaviour from becoming an unbounded row source.

**"Subscription canceled" is two different things.** `subscription_canceled` (the user pressed
cancel — churn *intent*, and the moment a save-offer could fire) and `subscription_ended` (access
actually lapsed at period end, often 30 days later). Conflating them makes churn timing unreadable.
Stripe distinguishes them.

**"Installation completed" needs a companion.** See `service_install_failed` below.

### 5.2 Full taxonomy

Bold = on the original list.

**Marketing / web**

| Event | Key props | Why |
|---|---|---|
| `page_viewed` | `path`, `title`, `referrer_host` | **Landing page viewed** — one event, filter by path. Pricing and download page views are queries, not separate events. |
| `signup_started` | `method` (`password`\|`google`), `surface` | The form-to-account drop-off is invisible today. |
| **`account_created`** | `method`, `surface` (`web`\|`desktop`) | |
| `signed_in` | `method`, `surface` | Returning activity; separates new from repeat. |
| **`download_clicked`** | `platform`, `app_version` | Fired **server-side** in the redirect route — §9.2. |

**Desktop — milestones only**

| Event | Key props | Why |
|---|---|---|
| **`app_installed`** | `platform`, `app_version`, `os_version` | "Installation completed" — first launch for a `device_id`. |
| `service_install_started` | `platform` | ← |
| `service_installed` | `platform`, `duration_ms` | ← |
| `service_install_failed` | `platform`, `reason` | **The most valuable addition here.** The product cannot function until a privileged daemon installs behind a UAC/`sudo`/admin prompt. Every install walks up to that cliff and you currently cannot see who falls off it or why. See `apps/desktop/src/main/service/installer.ts`. |
| `onboarding_step_viewed` | `step`, `version` | The walkthrough is already versioned (`ONBOARDING_VERSION`); step-level drop-off tells you which step to fix. |
| `onboarding_completed` / `onboarding_skipped` | `version` | |
| **`extension_connected`** | `browser`, `extension_version` | "Browser extension installed" — first heartbeat for a device. §9.4. |
| **`usb_key_paired`** | `method` (`serial`\|`marker`), `key_count` | First pairing on a device. |
| `usb_pair_failed` | `reason` (`no_drives`\|`unreadable`\|…) | Pairing is the product's core gate; silent failure here is silent churn. |
| **`schedule_created`** | `window_count`, `has_locked_window` | First schedule on a device. |
| `focus_session_completed` | `duration_s`, `source`, `ended_by`, `session_index` | **Capped at the first 3 per device.** Supplies "first/second session"; the rest lives in tier 2. |
| `app_uninstalled` | `platform`, `days_installed` | Best-effort from the NSIS uninstaller / `.deb` `postrm`. Partial data beats none. |

**Billing — all server-side, from the Stripe webhook**

| Event | Key props | Why |
|---|---|---|
| `checkout_started` | `price_id`, `surface` (`web`\|`desktop`) | Checkout abandonment is usually the largest single leak, and is unmeasurable without this. |
| **`trial_started`** | `price_id`, `trial_end` | |
| **`subscription_started`** | `price_id`, `amount`, `from_trial` | |
| **`subscription_renewed`** | `price_id`, `amount`, `renewal_index` | Requires a webhook change — §10. |
| `payment_failed` | `attempt`, `amount` | Involuntary churn is often 20–40% of total churn and is fixable with dunning. |
| **`subscription_canceled`** | `at_period_end`, `days_active` | Cancel *intent*. |
| `subscription_ended` | `days_active` | Access actually lapsed. |
| `refund_issued` | `amount` | |
| `comp_code_redeemed` | `code_id` | You have comp grants (`0004_comp_grants.sql`); comped users must be excluded from paid-conversion math or they quietly poison it. |

### 5.3 Derived, not emitted

Compute in SQL: Nth session, `activated` (paired a key **and** completed a focus session — the
right definition here, since either alone is inert), D1/D7/D30 retention, time-to-value,
trial-to-paid, download→install rate.

---

## 6. Usage telemetry (tier 2)

The goal: **exact daily active users, focus-hours, toggle counts and session lengths, at one row
per device per day.**

### 6.1 Why the Electron app cannot be the source of truth

The blocker is enforced by the privileged service, which runs always. The Electron UI runs only
when opened. If focus-time were accumulated in Electron, you would miss every hour the blocker ran
with the UI closed — which for this product is most of them. An Electron-only measure would
systematically undercount your single most important engagement metric, and undercount it *worst*
for your most habituated users, who open the UI least.

So focus-time accounting has to originate in the service.

### 6.2 The transition log

The service keeps a **bounded, monotonic log of state transitions** in its existing persisted
state, and the desktop drains it.

`native/*/src/state.rs` stores `PersistentState` as a JSON blob where every field is
`#[serde(default)]` and a `migrate()` runs on load, so adding a field is backward- and
forward-compatible with no migration step:

```rust
/// Bounded transition log for usage telemetry. Counts and durations only -- never domains,
/// app names, or anything describing what was blocked.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageTransition {
    pub seq: u64,          // monotonic, never reused
    pub at: u64,           // epoch ms, service clock
    pub kind: TransitionKind,   // FocusOn | FocusOff | ScheduleFired
    pub source: FocusSource,    // already exists in model.rs
}

// in PersistentState:
#[serde(default)]
pub usage_log: Vec<UsageTransition>,
#[serde(default)]
pub usage_seq: u64,
```

Pruned to the last 2,000 entries (weeks of history at ~8/day) and 35 days of age, whichever binds
first. A machine that never opens the UI cannot grow this without bound.

One new RPC in `packages/shared/src/protocol.ts` and `native/protocol/schema.json`:

```ts
/** Drain usage transitions newer than `afterSeq`. Read-only; no ack required. */
drainUsage: {
  params: { afterSeq: number };
  result: { transitions: UsageTransition[]; latestSeq: number };
};
```

No ack round-trip: the client persists `lastSeq` locally and asks for `> lastSeq`. Re-reads after a
crash are harmless because the upload queue dedupes on `idempotency_key`. The service prunes by cap
and age, never by client acknowledgement, so a broken client can never wedge the daemon's store.

**This is the only part of the plan that touches Rust**, and it touches all three services
(`native/{windows,linux,macos}/src/{model,state,ipc}.rs` plus `schema.json`). The modules are
parallel implementations with matching names, so it is the same small diff three times. §15 has a
phase-1 approximation that ships useful DAU without any Rust changes.

### 6.3 Rollup happens in `packages/core`

The architecture doc describes `packages/core` as "pure cross-platform business logic … so it's
testable without Electron or native code." That is exactly the right home:

```ts
export function rollupUsage(
  transitions: UsageTransition[],
  appOpens: Array<{ at: number }>,
  tzOffsetMinutes: number,
): DailyUsage[]
```

Pure function, fully unit-testable, no Electron and no native code. It:

- Pairs `FocusOn` → `FocusOff` into intervals.
- **Splits intervals at local midnight**, so a 10pm–6am locked window contributes 2h to one day and
  6h to the next rather than 8h to whichever day it started. Sessions crossing midnight are common
  for a sleep-adjacent blocker, and attributing them wholly to the start day visibly skews
  weekday/weekend analysis.
- Buckets by **device-local date**, because "daily usage" is a human-local concept. Store the
  `tz_offset_minutes` alongside so you can reconstruct UTC if you ever need to.
- Treats a trailing `FocusOn` with no matching `FocusOff` as "still on", accumulating up to *now*
  and leaving the day open for revision on the next upload.

### 6.4 The daily row

One row per `(device_id, local_date)`:

| Column | Meaning |
|---|---|
| `app_opens` | how often the user opened the UI |
| `focus_enabled_count` / `focus_disabled_count` | toggles |
| `focus_seconds` | **total time the blocker was on that day** — the headline number |
| `longest_focus_seconds` | the tail: is this person doing one long block or many short ones |
| `scheduled_focus_seconds` | of `focus_seconds`, how much came from a schedule rather than a manual toggle |
| `sessions_completed` / `sessions_aborted` | ran to the end vs unlocked early with the key |
| `key_present_seconds` | how long a paired key was plugged in (a leading indicator: key left in = blocker defeated in spirit) |
| `extension_connected` | did the browser layer work at all that day |
| `first_activity_at` / `last_activity_at` | daily span |

Counters are **cumulative for the day**, not deltas. The upsert then uses `greatest(existing,
incoming)`, which makes the whole pipeline idempotent *and* order-independent: a retry is a no-op,
and a stale flush arriving after a fresh one cannot regress the row. Delta-based increments would
double-count on every retry, and an offline desktop retries a lot.

### 6.5 Reporting cadence and its one honest limitation

The desktop flushes on launch, on a timer while open, and at quit. A device that runs the blocker
daily but never opens the UI for a week reports nothing for a week, then **backfills all seven
daily rows at once** from the transition log. The data is correct; it is late.

So `analytics_usage_daily` is *eventually* consistent, typically within a day, worst case up to the
log's 35-day horizon. Dashboards should show the last 2 days as provisional.

The alternative — having the privileged daemon upload directly — would give true real-time daily
reporting, and you should not do it. It would mean a `LocalSystem`/root process making outbound HTTP
and holding auth tokens, on a product whose entire pitch is that enforcement is local and nothing
about your browsing leaves the machine. The added trust and attack surface is not worth a reporting
latency improvement that nobody will notice in a weekly metrics review.

### 6.6 Defining "active" for a background blocker

Do not use "opened the app" as your DAU. For a tool designed to work invisibly, UI opens *fall* as
users get more habituated — you would watch your best cohort look like churn. Track three:

- **Installed base (30d)** — devices with any usage row in the last 30 days. Your denominator.
- **DAU-protected** — devices with `focus_seconds >= 60` that day. **This is the headline.** It
  measures the product doing its job.
- **DAU-UI** — devices with `app_opens > 0`. Measures the interface, not the product. Useful for
  judging whether a UI change got noticed; useless as a health metric.

Plus `WAU`, `MAU`, stickiness (`DAU/MAU`), and median daily focus minutes among protected-active
devices. Report both per-device and per-person (via the identity join) — one person with a laptop
and a desktop is one customer, and the gap between the two counts is itself worth watching.

---

## 7. Schema

New migration `apps/web/supabase/migrations/0006_analytics.sql`. Four tables and three views.

RLS posture follows `connections` in `0002_connections.sql`: RLS on, no policies, all access via
`supabaseAdmin()`. Clients never touch these tables directly.

```sql
-- Analytics: append-only milestone events + daily usage rollups + a small identity graph.
--
-- Events store RAW identifiers (anon/device/user); person resolution happens in the
-- *_resolved views at query time. An identity merge then repoints one row in
-- analytics_identities and every historical row follows -- no backfill, no denormalized
-- person_id to drift.

create table public.analytics_persons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  -- First-touch attribution. Immutable once set: the channel that earned the person.
  first_utm_source text,
  first_utm_medium text,
  first_utm_campaign text,
  first_referrer_host text,
  first_landing_path text,
  first_country text,
  -- Last-touch, for multi-touch sanity checks.
  last_utm_source text,
  last_utm_medium text,
  last_utm_campaign text
);

-- Identifier -> person. Key is prefixed ('anon:<uuid>' | 'device:<uuid>' | 'user:<uuid>')
-- so one text PK covers all three spaces without a composite key.
create table public.analytics_identities (
  identifier text primary key,
  person_id uuid not null references public.analytics_persons(id) on delete cascade,
  first_seen_at timestamptz not null default now()
);
create index analytics_identities_person_idx on public.analytics_identities(person_id);

-- Tier 1: milestones. Grows with people, not with time.
create table public.analytics_events (
  id bigint generated always as identity primary key,
  event text not null,
  -- Client clock, clamped to received_at +/- 24h at ingest (desktop clocks drift and an
  -- offline buffer can flush days late).
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),

  anon_id uuid,
  device_id uuid,
  user_id uuid,

  source text not null,           -- 'web' | 'desktop' | 'server'
  app_version text,
  platform text,                  -- 'win' | 'mac' | 'linux'

  -- Attribution snapshot at event time. Denormalized deliberately: it makes every funnel
  -- query groupable by channel without touching analytics_persons.
  utm_source text,
  utm_medium text,
  utm_campaign text,
  referrer_host text,
  country text,

  props jsonb not null default '{}'::jsonb,

  -- Desktop retries after an offline flush; this makes re-delivery a no-op.
  idempotency_key text unique
);

create index analytics_events_event_time_idx on public.analytics_events(event, occurred_at desc);
create index analytics_events_time_idx       on public.analytics_events(occurred_at desc);
create index analytics_events_anon_idx       on public.analytics_events(anon_id)   where anon_id is not null;
create index analytics_events_device_idx     on public.analytics_events(device_id) where device_id is not null;
create index analytics_events_user_idx       on public.analytics_events(user_id)   where user_id is not null;

-- Tier 2: one row per device per day. Counters are CUMULATIVE FOR THE DAY, never deltas,
-- so the upsert can use greatest() and stay idempotent under retry and reordering.
--
-- Contains counts and durations only. No domains, no app names, no URLs -- nothing
-- describing what a user blocks or visits ever leaves the device.
create table public.analytics_usage_daily (
  device_id uuid not null,
  local_date date not null,
  tz_offset_minutes smallint not null,

  user_id uuid,                   -- last known on this device that day
  platform text not null,
  app_version text,

  app_opens smallint not null default 0,
  focus_enabled_count smallint not null default 0,
  focus_disabled_count smallint not null default 0,
  focus_seconds integer not null default 0,
  longest_focus_seconds integer not null default 0,
  scheduled_focus_seconds integer not null default 0,
  sessions_completed smallint not null default 0,
  sessions_aborted smallint not null default 0,
  key_present_seconds integer not null default 0,
  extension_connected boolean not null default false,

  first_activity_at timestamptz,
  last_activity_at timestamptz,
  reported_at timestamptz not null default now(),

  primary key (device_id, local_date)
);

create index analytics_usage_date_idx   on public.analytics_usage_daily(local_date desc);
create index analytics_usage_user_idx   on public.analytics_usage_daily(user_id) where user_id is not null;
-- Powers "DAU-protected" without scanning idle rows.
create index analytics_usage_active_idx on public.analytics_usage_daily(local_date desc)
  where focus_seconds >= 60;

-- Resolution views: the only things dashboards read.
create or replace view public.analytics_events_resolved as
select
  e.*,
  coalesce(iu.person_id, idv.person_id, ia.person_id) as person_id
from public.analytics_events e
left join public.analytics_identities iu  on iu.identifier  = 'user:'   || e.user_id::text
left join public.analytics_identities idv on idv.identifier = 'device:' || e.device_id::text
left join public.analytics_identities ia  on ia.identifier  = 'anon:'   || e.anon_id::text;

create or replace view public.analytics_usage_resolved as
select
  u.*,
  coalesce(iu.person_id, idv.person_id) as person_id
from public.analytics_usage_daily u
left join public.analytics_identities iu  on iu.identifier  = 'user:'   || u.user_id::text
left join public.analytics_identities idv on idv.identifier = 'device:' || u.device_id::text;

alter table public.analytics_persons     enable row level security;
alter table public.analytics_identities  enable row level security;
alter table public.analytics_events      enable row level security;
alter table public.analytics_usage_daily enable row level security;
revoke all on public.analytics_persons     from authenticated, anon;
revoke all on public.analytics_identities  from authenticated, anon;
revoke all on public.analytics_events      from authenticated, anon;
revoke all on public.analytics_usage_daily from authenticated, anon;
```

Add matching row types to `apps/web/src/lib/supabase/types.ts` and register the tables in
`database.types.ts` — that file is hand-maintained, per its own header comment.

### 7.1 The usage upsert

```sql
-- Idempotent under retry and reordering: counters only ever move up within a day.
create or replace function public.analytics_report_usage(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with incoming as (
    select * from jsonb_populate_recordset(null::public.analytics_usage_daily, p_rows)
  )
  insert into public.analytics_usage_daily as t
  select * from incoming
  on conflict (device_id, local_date) do update set
    user_id                 = coalesce(excluded.user_id, t.user_id),
    platform                = excluded.platform,
    app_version             = excluded.app_version,
    tz_offset_minutes       = excluded.tz_offset_minutes,
    app_opens               = greatest(t.app_opens,               excluded.app_opens),
    focus_enabled_count     = greatest(t.focus_enabled_count,     excluded.focus_enabled_count),
    focus_disabled_count    = greatest(t.focus_disabled_count,    excluded.focus_disabled_count),
    focus_seconds           = greatest(t.focus_seconds,           excluded.focus_seconds),
    longest_focus_seconds   = greatest(t.longest_focus_seconds,   excluded.longest_focus_seconds),
    scheduled_focus_seconds = greatest(t.scheduled_focus_seconds, excluded.scheduled_focus_seconds),
    sessions_completed      = greatest(t.sessions_completed,      excluded.sessions_completed),
    sessions_aborted        = greatest(t.sessions_aborted,        excluded.sessions_aborted),
    key_present_seconds     = greatest(t.key_present_seconds,     excluded.key_present_seconds),
    extension_connected     = t.extension_connected or excluded.extension_connected,
    first_activity_at       = least(t.first_activity_at, excluded.first_activity_at),
    last_activity_at        = greatest(t.last_activity_at, excluded.last_activity_at),
    reported_at             = now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.analytics_report_usage(jsonb) from public, anon, authenticated;
```

A whole backfill — a week of catch-up rows — is one call with a JSON array.

---

## 8. Identity resolution

One function does all the graph work. Called once per ingest, before the write.

```sql
-- Links a set of identifiers to a single person, merging pre-existing persons when the
-- identifiers arrive already belonging to different ones (e.g. a device seen anonymously
-- now signs in as a known web visitor). Oldest person wins; losers are repointed and
-- deleted. Events and usage rows are untouched -- they resolve through the views.
create or replace function public.analytics_link(p_identifiers text[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person uuid;
  v_found uuid[];
begin
  select array_agg(distinct person_id) into v_found
  from public.analytics_identities
  where identifier = any(p_identifiers);

  if v_found is null or array_length(v_found, 1) = 0 then
    insert into public.analytics_persons default values returning id into v_person;
  else
    select id into v_person
    from public.analytics_persons
    where id = any(v_found)
    order by first_seen_at asc, id asc
    limit 1;

    if array_length(v_found, 1) > 1 then
      update public.analytics_identities
        set person_id = v_person
        where person_id = any(v_found) and person_id <> v_person;
      -- Carry the earliest first-touch forward, then drop the merged-away rows.
      update public.analytics_persons w set
        first_seen_at       = least(w.first_seen_at, l.first_seen_at),
        first_utm_source    = coalesce(w.first_utm_source,    l.first_utm_source),
        first_utm_medium    = coalesce(w.first_utm_medium,    l.first_utm_medium),
        first_utm_campaign  = coalesce(w.first_utm_campaign,  l.first_utm_campaign),
        first_referrer_host = coalesce(w.first_referrer_host, l.first_referrer_host),
        first_landing_path  = coalesce(w.first_landing_path,  l.first_landing_path),
        first_country       = coalesce(w.first_country,       l.first_country)
      from (
        select * from public.analytics_persons
        where id = any(v_found) and id <> v_person
        order by first_seen_at asc limit 1
      ) l
      where w.id = v_person;

      delete from public.analytics_persons
      where id = any(v_found) and id <> v_person;
    end if;
  end if;

  insert into public.analytics_identities (identifier, person_id)
  select unnest(p_identifiers), v_person
  on conflict (identifier) do nothing;

  -- Promote user_id onto the person when we learn it.
  update public.analytics_persons p
     set user_id = substring(i.identifier from 6)::uuid
    from unnest(p_identifiers) i(identifier)
   where p.id = v_person
     and i.identifier like 'user:%'
     and p.user_id is null;

  update public.analytics_persons set last_seen_at = now() where id = v_person;
  return v_person;
end;
$$;

revoke all on function public.analytics_link(text[]) from public, anon, authenticated;
```

First-touch attribution is written by the ingest route when it creates a person and sees UTM
params; it is never overwritten afterwards.

---

## 9. Ingest paths

### 9.1 The seam

`apps/web/src/server/analytics/track.ts` — server-side, the only thing that writes:

```ts
export async function track(input: TrackInput): Promise<void>
export async function reportUsage(input: UsageReport): Promise<void>
```

`track()` validates against a zod enum of known event names, calls `analytics_link`, inserts the
row via `supabaseAdmin()`, then fires PostHog through the existing `getPosthogServer()` inside a
`try/catch` that swallows everything. **Analytics must never break a user flow** — the entire body
runs inside a catch that reports to Sentry and returns.

`POST /api/analytics/track` and `POST /api/analytics/usage` wrap them for client and desktop.

### 9.2 Web client

Thin `trackEvent()` in `posthog-client.ts` posts to `/api/analytics/track`. The `tal_aid` cookie
rides along automatically; the server reads it rather than trusting a client-supplied id. Use
`navigator.sendBeacon` for anything racing a navigation.

For **download clicks specifically, do not rely on the client at all.**
`/api/desktop/download` is already a server-side 302 on our own domain, so it fires even with an ad
blocker installed, even if JS fails, and it cannot be missed because the redirect *is* the
download. Track it there. Highest-integrity signal in the funnel; instrument it first.

### 9.3 Desktop

New `apps/desktop/src/main/analytics.ts`:

- Generates/persists `device_id` next to `onboarding.json`.
- **Tier 1:** appends milestone events to a newline-delimited local queue file, each with an
  `idempotency_key`.
- **Tier 2:** on launch, on a 15-minute timer while open, and at quit — calls `drainUsage`, feeds
  transitions through `rollupUsage()` from `packages/core`, and upserts the affected days via
  `POST /api/analytics/usage`. Only days that changed are sent, so the steady-state payload is one
  small row.
- Sends the Supabase access token as `Authorization: Bearer` when signed in (the pattern
  `/api/desktop/entitlement` already uses via `requireBearerUser`), unauthenticated with just
  `device_id` when not.
- Caps the queue (5,000 events / 2 MB, oldest dropped) so a permanently offline machine cannot grow
  a file without bound.
- Never blocks the UI; failures log through `logger` and retry on the next flush.

Offline buffering is not optional. This is a blocker app — people run it precisely when their
network access is restricted.

### 9.4 Extension

**The extension should not phone home.** It already reports liveness to the privileged service via
native messaging, and the service re-emits that as `extensionHeartbeat`
(`packages/shared/src/events.ts`) carrying `browser`, `pid`, `extensionVersion`, and `healthy`. The
desktop main process is already subscribed.

So `extension_connected` and the daily `extension_connected` flag both derive from a heartbeat you
already receive. Strictly better than adding a network call to the extension: no new host
permissions, nothing new to justify in a Chrome Web Store review, no privacy surface added to a
product whose pitch is local enforcement — and more accurate, because it proves the extension is
*working*, not merely installed.

### 9.5 Stripe webhook

All billing events emit from `api/stripe/webhook/route.ts`, never the client — the client can lie,
navigate away, or double-fire, and the webhook is already idempotent via `stripe_events`. Resolve
`user_id` from the Stripe customer, then `track()`.

---

## 10. Where each signal originates (file by file)

| Signal | Location |
|---|---|
| `page_viewed` | `apps/web/src/app/providers.tsx` — extend the existing `PostHogPageview` to dual-emit. |
| `download_clicked` | `apps/web/src/app/api/desktop/download/route.ts` — before the 302. |
| `signup_started` | `apps/web/src/app/(auth)/signup` form submit. |
| `account_created` | `apps/web/src/app/api/auth/callback/route.ts` (`flow=signup`) and the desktop `signUpPassword` handler. |
| `signed_in` | Same callback route + `signInPassword` / `signInGoogle` handlers. |
| `app_installed` | `apps/desktop/src/main/index.ts` startup; first run detected via the new `device_id` file. |
| `service_install_*` | `apps/desktop/src/main/service/installer.ts`. |
| `onboarding_*` | `apps/desktop/src/main/onboarding.ts` + the renderer walkthrough. |
| `extension_connected` | Desktop main's `extensionHeartbeat` subscription (§9.4). |
| `usb_key_paired`, `usb_pair_failed` | `pairKey` handler in `apps/desktop/src/main/ipc/handlers.ts`. |
| `schedule_created` | `setSchedule` handler, same file. |
| `focus_session_completed` (first 3) | Desktop main's `focusChanged` subscription, gated on a local lifetime counter. |
| `checkout_started` | `api/stripe/checkout/route.ts` and `api/desktop/checkout/route.ts`. |
| `trial_started`, `subscription_started`, `subscription_canceled`, `subscription_ended`, `payment_failed`, `refund_issued` | `api/stripe/webhook/route.ts`, in the existing `switch`. |
| `subscription_renewed` | **Needs a webhook change** — see below. |
| `comp_code_redeemed` | `api/comp/redeem/route.ts` and `api/desktop/comp/redeem/route.ts`. |
| **Usage transitions** | `native/{windows,linux,macos}/src/{model,state,ipc}.rs` + `native/protocol/schema.json` + `packages/shared/src/protocol.ts`. |
| **Usage rollup** | `packages/core` (`rollupUsage`), consumed by `apps/desktop/src/main/analytics.ts`. |
| `app_opens` | Desktop main window-show handler. |
| `key_present_seconds` | Derived from `keyPresenceChanged` transitions in the same log. |

**The one required change to existing behaviour:** `relevantEvents` in the Stripe webhook
(`route.ts:14`) does not include `invoice.payment_succeeded`, so renewals are currently invisible —
`customer.subscription.updated` fires on renewal but does not tell you a payment cleared. Add it,
and emit `subscription_renewed` only when `billing_reason = 'subscription_cycle'`, which excludes
the initial `subscription_create` invoice so signup is not double-counted as a renewal.

Everything else is additive. No existing behaviour changes, and every `track()` call is
fire-and-forget inside a catch.

---

## 11. Queries

### 11.1 The funnel

One row per person with a timestamp per milestone:

```sql
create or replace view public.analytics_funnel as
select
  p.id as person_id,
  p.first_seen_at,
  p.first_utm_source,
  p.first_utm_medium,
  p.first_utm_campaign,
  p.first_referrer_host,
  min(e.occurred_at) filter (where e.event = 'page_viewed')             as visited_at,
  min(e.occurred_at) filter (where e.event = 'download_clicked')        as downloaded_at,
  min(e.occurred_at) filter (where e.event = 'app_installed')           as installed_at,
  min(e.occurred_at) filter (where e.event = 'service_installed')       as service_ready_at,
  min(e.occurred_at) filter (where e.event = 'account_created')         as signed_up_at,
  min(e.occurred_at) filter (where e.event = 'extension_connected')     as extension_at,
  min(e.occurred_at) filter (where e.event = 'usb_key_paired')          as paired_at,
  min(e.occurred_at) filter (where e.event = 'schedule_created')        as scheduled_at,
  min(e.occurred_at) filter (where e.event = 'focus_session_completed'
                               and (e.props->>'session_index')::int = 1) as first_session_at,
  min(e.occurred_at) filter (where e.event = 'focus_session_completed'
                               and (e.props->>'session_index')::int = 2) as second_session_at,
  min(e.occurred_at) filter (where e.event = 'trial_started')           as trial_at,
  min(e.occurred_at) filter (where e.event = 'subscription_started')    as paid_at,
  min(e.occurred_at) filter (where e.event = 'subscription_canceled')   as canceled_at
from public.analytics_persons p
left join public.analytics_events_resolved e on e.person_id = p.id
group by p.id;
```

Funnel counts by channel:

```sql
select
  coalesce(first_utm_source, first_referrer_host, 'direct') as channel,
  count(*)              as visitors,
  count(downloaded_at)  as downloaded,
  count(installed_at)   as installed,
  count(signed_up_at)   as accounts,
  count(paired_at)      as paired,
  count(first_session_at)  as activated,
  count(second_session_at) as habit_forming,
  count(trial_at)       as trials,
  count(paid_at)        as paid,
  round(100.0 * count(paid_at) / nullif(count(*), 0), 2) as pct_visitor_to_paid
from public.analytics_funnel
where first_seen_at >= now() - interval '90 days'
group by 1
order by visitors desc;
```

### 11.2 Daily active users

```sql
create or replace view public.analytics_dau as
select
  local_date,
  count(*)                                                   as devices_reporting,
  count(*) filter (where focus_seconds >= 60)                as dau_protected,
  count(*) filter (where app_opens > 0)                      as dau_ui,
  count(distinct person_id) filter (where focus_seconds >= 60) as people_protected,
  round(sum(focus_seconds) / 3600.0, 1)                      as total_focus_hours,
  round(avg(focus_seconds) filter (where focus_seconds >= 60) / 60.0, 1)
                                                             as avg_active_focus_minutes,
  percentile_cont(0.5) within group (order by focus_seconds)
    filter (where focus_seconds >= 60)                       as median_focus_seconds,
  sum(sessions_completed)                                    as sessions_completed,
  sum(sessions_aborted)                                      as sessions_aborted
from public.analytics_usage_resolved
group by local_date;
```

Stickiness and the 30-day installed base:

```sql
select
  d.local_date,
  d.dau_protected,
  (select count(distinct person_id) from public.analytics_usage_resolved u
    where u.local_date > d.local_date - 30 and u.local_date <= d.local_date
      and u.focus_seconds >= 60)                             as mau_protected,
  (select count(distinct device_id) from public.analytics_usage_daily u
    where u.local_date > d.local_date - 30 and u.local_date <= d.local_date)
                                                             as installed_base_30d
from public.analytics_dau d
where d.local_date >= current_date - 90
order by d.local_date desc;
```

### 11.3 Retention by install cohort

```sql
with cohort as (
  select device_id, min(local_date) as installed_on
  from public.analytics_usage_daily group by device_id
)
select
  date_trunc('week', c.installed_on)::date as cohort_week,
  count(distinct c.device_id)              as devices,
  count(distinct c.device_id) filter (
    where exists (select 1 from public.analytics_usage_daily u
                  where u.device_id = c.device_id
                    and u.local_date = c.installed_on + 7
                    and u.focus_seconds >= 60)) as d7_protected,
  count(distinct c.device_id) filter (
    where exists (select 1 from public.analytics_usage_daily u
                  where u.device_id = c.device_id
                    and u.local_date = c.installed_on + 30
                    and u.focus_seconds >= 60)) as d30_protected
from cohort c
group by 1 order by 1 desc;
```

---

## 12. The dashboards

### 12.1 Two stable targets

`/insights` always reads the dedicated production analytics credentials and `/insights/dev`
always reads the local Supabase credentials. Neither uses `config.supabase` or
`supabaseAdmin()`, so both routes show the same datasets under `pnpm web:dev` and
`pnpm web:prod`. `src/server/analytics/db.ts` module-caches one service-role client per target and
adds a four-second timeout. Request-cached panel queries return discriminated errors rather than
throwing.

### 12.2 Keeping them off production

Both routes live under `src/app/(dev)` and are protected by two independent guards:
`NODE_ENV === "production"` always returns 404 on a deployment, and the locally-synced
`config.insights.enabled` flag must also be true. There are no route handlers under the group.
The pages are force-dynamic server components, excluded from page-view tracking, robots, and the
sitemap. `/insights/dev` has a sticky warning banner and stable `data-insights-target="dev"` hook;
each dashboard links to the other.

### 12.3 Panels

1. **The funnel.** Vertical bar per step with absolute count and step-over-step conversion, plus
   median time-to-step. Date range + channel filter. Label the download→install step as *estimated*
   (§4.3) so nobody quietly trusts a modelled number as a measured one.
2. **Channel table.** First-touch source/medium × visitors → accounts → trials → paid. The panel
   that decides where marketing money goes.
3. **Active users.** DAU-protected as the headline line chart, with DAU-UI and installed-base-30d
   as secondary series, plus WAU/MAU stickiness. Grey out the last 2 days as provisional (§6.5).
4. **Engagement depth.** Median daily focus minutes, distribution of session lengths, scheduled vs
   manual focus split, sessions completed vs aborted. Answers "how long do they keep it on."
5. **Retention cohorts.** Install week down the side, % protected-active at D1/D7/D30 across.
6. **Desktop install health.** `app_installed` → `service_installed` → `extension_connected` by
   platform, with `service_install_failed` grouped by reason. Expect this one to surprise you most,
   because it measures the part of the funnel you currently cannot see at all.
7. **Revenue.** Trials started/converted/expired, active subs, MRR, cancels split by intent vs
   ended, involuntary churn from `payment_failed`. Joins straight to `subscriptions`.
8. **Raw stream.** Last 200 events and the 50 most recent usage rows, with identifiers and props.
   Unglamorous, and the thing you will use most while building instrumentation — without it you are
   debugging blind.

Keep it server-rendered HTML and CSS. Resist adding a charting library until panels 1–8 exist and
you have found yourself genuinely wanting one.

---

## 13. Volume, retention, compaction

Assume ~15 usage-ish signals per active device per day (1–2 app opens, ~3 focus toggle pairs, ~3
session boundaries, schedule fires, key presence changes).

| Active devices | As raw events | As daily rollups | Ratio |
|---|---|---|---|
| 100 | 550 k rows/yr (~220 MB) | 36.5 k rows/yr (~5 MB) | 15× rows, ~45× bytes |
| 1,000 | 5.5 M rows/yr (~2.2 GB) | 365 k rows/yr (~45 MB) | ″ |
| 10,000 | 55 M rows/yr (~22 GB) | 3.65 M rows/yr (~440 MB) | ″ |

Bytes assume ~400 B per event row (identifiers, attribution columns, `props` jsonb, indexes) versus
~120 B for a fixed-width daily row. The rollup wins on bytes by more than it wins on rows because
the daily row carries no jsonb and no repeated attribution.

Tier 1 is negligible at any of these scales: ~30 rows per person, ever. Ten thousand customers is
300 k rows total.

**Compaction.** Not needed for years. When `analytics_usage_daily` passes ~5 M rows, add a monthly
rollup (`analytics_usage_monthly`, same columns summed, plus `active_days`) and drop dailies older
than 13 months — 13 so you always retain a full year plus the year-over-year comparison month.
Schedule it with `pg_cron`, which Supabase supports. Do not do this preemptively; you will want the
daily grain while you are still learning what questions to ask.

**Partitioning** by `local_date` becomes worth it past ~20 M rows. Not before.

---

## 14. Hardening, privacy, ops

**Both ingest endpoints are public and unauthenticated.** They have to be — anonymous visitors and
not-yet-signed-in desktops are exactly the population being measured. So:

- **Allowlist event names** with a zod enum; reject unknown names with a 400. Main defence against
  a junk-filled fact table, and it doubles as a typo catcher during development.
- **Validate usage rows hard**: `focus_seconds <= 86400`, counters within `smallint`, `local_date`
  within ±40 days of today, at most 40 rows per request. A device with a broken clock should get a
  rejected row, not a 9,000-hour day skewing your averages.
- **Rate limit** per IP and per `device_id`, generously.
- **Cap payloads**: reject bodies over ~8 KB for events, ~32 KB for usage batches; `props` limited
  to ~30 keys.
- **Clamp `occurred_at`** into `received_at ± 24h`.
- **Never trust client-supplied `anon_id` or `user_id`.** Read `anon_id` from the cookie; derive
  `user_id` from the bearer token. Only `device_id` is client-asserted, and it authorizes nothing.
- **Classify bots** on `page_viewed` as `props.ua_class = 'bot'`, retain the raw row, and filter it
  in funnel views so the decision remains reversible and countable.

**Privacy.** This matters more than usual here, because you sell a privacy-respecting local
blocker and daily telemetry is exactly the thing a skeptical user will look for.

- The daily row contains **counts and durations only**. No domains, no app names, no URLs, no
  window titles, nothing describing *what* was blocked or visited. Enforce this at the type level
  in `packages/core` so it cannot regress: the rollup's output type has no string fields other than
  `platform` and `app_version`.
- Store `country` (from `request.geo` on Vercel), never raw IPs. For the download→install estimate,
  store a **salted hash** of the IP with the salt rotating daily — same-day matching and nothing
  else.
- Keep PII out of `props`. `user_id` joins to `profiles` when you need an email; there is no reason
  to copy one into an event row.
- **Add `telemetryEnabled` to `Settings`** in `packages/shared/src/settings.ts`, default on, with a
  visible toggle and a plain-language explanation of exactly what the daily row contains. Opt-out
  rather than opt-in: opt-in telemetry typically sees single-digit adoption and the sample skews
  hard toward enthusiasts, which makes the data worse than no data because it looks trustworthy.
  Opt-out with honest disclosure is the defensible position, and being able to point at this
  document's "counts and durations only" guarantee is what makes it defensible.
- Add a product-analytics paragraph to the privacy policy before any of this ships.

**Testing.** Vitest unit tests for `rollupUsage` — midnight splitting, an unterminated `FocusOn`, a
transition log with a clock that jumps backwards — and for the merge path in `analytics_link`, since
two persons converging is where identity graphs go wrong. One integration test that a `track()`
call inserts exactly one row and links exactly one person, and one that a replayed usage batch is a
no-op.

---

## 15. Build order

Each phase is independently useful; stop after any of them and you are better off than today.

**Phase 1 — foundation (complete).** Migration `0006_analytics.sql`, `analytics_link`,
`analytics_report_usage`, the `track()` seam, `POST /api/analytics/track`, `tal_aid` in middleware,
PostHog key in `.credentials`.

**Phase 2 — the web funnel (complete).** `page_viewed`, `download_clicked` (server-side in the redirect
route), `signup_started`, `account_created`, `signed_in`. *Do the download route first — highest
integrity signal you have, and about ten lines.*

**Phase 3 — the dashboards (complete).** Migration `0007_analytics_views.sql`, dedicated prod/dev
target clients, `/insights`, `/insights/dev`, all eight operational panels, migration state, and
raw streams.

**Phase 4 — billing (complete).** Webhook events, `checkout_started`, and the `invoice.payment_succeeded`
addition. Entirely server-side, so this is the most reliable data in the system.

**Phase 5 — desktop milestones.** `device_id`, the offline queue, `app_installed`, the
`service_install_*` trio, pairing, schedule, extension heartbeat, first-3 sessions. Biggest phase,
biggest payoff — this is the half of the funnel that is currently dark.

**Phase 6 — usage, without touching Rust.** Ship a useful approximation first: Electron already
receives `focusChanged` events while it is open and can read `focus_active` from `getState` on
launch. Accumulate `app_opens`, toggle counts, and *observed* focus seconds into the daily row.
This gives you correct DAU-UI, correct toggle counts, correct installed base, and an
**undercounted** `focus_seconds`. Land it, mark the column provisional in the dashboard, and start
collecting — an undercount you understand is far more useful than no data for another month.

**Phase 7 — usage, exact.** The transition log in all three native services, `drainUsage`,
`rollupUsage` in `packages/core`, backfill on launch. `focus_seconds` becomes exact and the
midnight-split and UI-closed gaps disappear. Keep phase 6's rows — the ratio between observed and
true focus time across the overlap is itself an interesting number.

**Phase 8 — polish.** Retention cohorts, install-health panel, `app_uninstalled`, onboarding
step-level events, monthly compaction when volume warrants.

A reasonable stopping point for the funnel is phase 4: you can answer "which channel produces
paying customers" end to end. Phase 6 is the cheapest path to a real DAU number. Phase 7 is what
turns "how many people opened the app" into "how many hours of focus did we actually deliver
yesterday" — which, for a product that succeeds by running invisibly, is the only engagement metric
that means anything.
