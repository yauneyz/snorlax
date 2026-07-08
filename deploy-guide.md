# Talysman Web Deploy Guide

How the web app (`apps/web`) gets configured, run locally, and deployed to production.
Covers every moving part: Supabase (local + cloud), Vercel, Stripe, env plumbing, and the
runbooks for day-to-day dev and prod updates.

Everything here was verified against the repo, the Supabase/Vercel CLIs, and the vendor
docs as of 2026-07-08.

---

## 1. The big picture

```
                        .credentials (repo root, gitignored TOML)
                        single source of truth for ALL secrets/config
                                        │
                          scripts/sync-env.ts  (zod-validated)
                          ┌─────────────┼──────────────────┐
                 mode=dev │    mode=prod│                   │ --production
                          ▼             ▼                   ▼
              apps/web/.env.local   apps/web/.env.local   vercel env add (production)
              + root .env.local     (prod values,          one var at a time
              (desktop VITE_* vars)  local server)
                          │             │                   │
                          ▼             ▼                   ▼
                     `next dev`    `next dev` against   Vercel build + runtime
                     against local  cloud Supabase       (production deploys)
                     Supabase       ("pnpm prod")
```

The runtime pieces:

| Piece | Dev | Prod |
|---|---|---|
| Web app | `next dev` on `localhost:3000` | Vercel project **snorlax-web** (root dir `apps/web`) |
| Database + auth | Local Supabase stack (Docker, `supabase start`) | Cloud project `lkanoehzgogtrxzycutl.supabase.co` |
| Stripe | Test mode + `stripe listen` webhook forwarding | Live mode + dashboard webhook endpoint |
| LLM | Local vLLM (`LLM_PROVIDER=local`) | OpenAI (`LLM_PROVIDER=openai`) |
| App URL | `http://localhost:3000` | `https://talysman.app` |
| Email | Inbucket (local mail catcher, port 54324) | Resend |
| Sentry / PostHog | Disabled (placeholder values auto-detected and skipped) | Enabled when real values are in `.credentials` |

Two things are configured **independently** of each other — this is the most important
mental model in the whole setup:

1. **Mode (`dev`/`prod`)** — picked when you run `sync-env`; selects which Supabase
   project, app URL, and LLM provider get written to `.env.local`.
2. **Stripe mode (`test`/`live`)** — set by `[stripe].mode` inside `.credentials`;
   selects which Stripe keys get exported regardless of dev/prod mode. So you can (and
   normally do) run "prod" mode locally with Stripe still in test mode.

---

## 2. The configuration spine: `.credentials` → `sync-env.ts` → env vars

### `.credentials` (repo root)

A TOML file, gitignored, validated against a zod schema in `scripts/sync-env.ts`. The
committed template is `.credentials.example`. Sections: `[app]`, `[supabase.dev]`,
`[supabase.prod]`, `[stripe]`, `[resend]`, `[sentry]`, `[posthog]`, `[google]`, `[aws]`,
`[extension_hosting]`, `[extension_stores]`, `[openai]`, `[local_llm]`, `[security]`.

If validation fails, sync-env prints exactly which field is wrong and exits — so a typo
here fails loudly at sync time, not at request time in production.

### `scripts/sync-env.ts` — the four ways it runs

| Command (from `apps/web`) | What it does |
|---|---|
| `pnpm sync:env` | mode=dev → writes `apps/web/.env.local` (dev Supabase, local LLM) and root `.env.local` (desktop `VITE_*` vars). Runs automatically before `pnpm dev` (`predev` hook). |
| `pnpm sync:env -- --mode=prod` | Same two files but with prod values (cloud Supabase, OpenAI, `https://talysman.app`). This is what `pnpm prod` does before starting `next dev`. |
| `pnpm sync:env:build` | Runs before `pnpm build` (`prebuild` hook). On a Vercel build (`VERCEL=1`) with no `.credentials` present it **skips entirely** and lets Vercel's own env vars win. Locally it writes prod-mode files. |
| `pnpm sync:env:prod` | **Pushes** every non-empty var to Vercel's *production* environment via `vercel env add <NAME> production`. Does not write local files. |

Gotchas baked into the script (worth knowing, they will bite otherwise):

- `vercel env add` **fails if the variable already exists**. The script stops on the
  first conflict and tells you to `vercel env rm <NAME> production` first. There is no
  built-in "update" — to re-push everything you remove the old vars first (see §6.3).
- Empty values are skipped on push, so optional stuff (Sentry, PostHog) never creates
  empty vars on Vercel.
- Prod mode **requires** `openai.api_key` to be set, because prod uses OpenAI.
- Placeholder detection: values containing `...` (from the example file) are treated as
  "unset" for PostHog/Sentry, so a half-filled `.credentials` degrades gracefully.

### `apps/web/src/lib/config.ts` — runtime validation

No module reads `process.env` directly; everything imports the typed `config` object,
which zod-validates the env at module load. Consequences:

- A missing required var crashes the server **at startup/build**, not on the first
  request that happens to need it. If a Vercel build fails with "Invalid … env config",
  the error names the exact missing variable.
- `NEXT_PUBLIC_*` vars are **inlined into the client bundle at build time** by Next.js.
  Changing one on Vercel does nothing until you rebuild/redeploy.
- Supabase key naming: the app canonically uses `NEXT_PUBLIC_SUPABASE_ANON_KEY`, but
  `config.ts` falls back to `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — that's the name the
  Supabase↔Vercel marketplace integration injects. Either satisfies the schema.

### How the app talks to Supabase (four clients)

| File | Key used | Where it runs |
|---|---|---|
| `src/lib/supabase/browser.ts` | publishable key | Client components (RLS enforced) |
| `src/lib/supabase/server.ts` | publishable key + user cookies | Server components / route handlers (RLS enforced as the user) |
| `src/lib/supabase/middleware.ts` → `src/middleware.ts` | publishable key | Edge middleware; refreshes auth cookies, gates `/app/**` on login + active subscription |
| `src/lib/supabase/admin.ts` | **secret key — bypasses RLS** | Server-only (webhook, `src/server/**`); an eslint rule blocks importing it elsewhere |

---

## 3. Dev setup (local)

### 3.1 One-time prerequisites

- Docker (the local Supabase stack is ~10 containers)
- `supabase` CLI (installed: 2.108.0), `vercel` CLI (54.21.0), `stripe` CLI, pnpm
- A filled-in `.credentials` at the repo root (copy from `.credentials.example`)

### 3.2 Start the local Supabase stack

```bash
cd apps/web
supabase start        # boots Postgres, Auth, Storage, Studio… applies migrations + seed.sql
supabase status       # prints URLs and keys
```

`supabase/config.toml` **only configures this local stack** (ports, auth redirect URLs,
email confirmations off, Google provider off). The cloud project ignores it entirely —
its equivalents live in the Supabase dashboard (§5.2).

Local service map:

| Service | URL |
|---|---|
| API (what the app talks to) | `http://127.0.0.1:54321` |
| Postgres | `127.0.0.1:54322` |
| Studio (dashboard UI) | `http://127.0.0.1:54323` |
| Inbucket (catches all auth emails) | `http://127.0.0.1:54324` |

Copy the publishable/secret keys from `supabase status` into `[supabase.dev]` in
`.credentials` (already done in yours).

### 3.3 Run the web app

```bash
# from repo root
pnpm web:dev          # = predev sync:env (dev mode) + next dev on :3000
```

For Stripe checkout/webhook flows locally, in a second terminal:

```bash
stripe listen --forward-to http://localhost:3000/api/stripe/webhook
```

and put the `whsec_...` it prints into `[stripe].webhook_secret_test`. (Re-run
`pnpm sync:env` after editing `.credentials` — or just restart dev, the predev hook does it.)

### 3.4 The hybrid "prod mode locally"

```bash
pnpm web:prod         # sync-env --mode=prod, then next dev on :3000
```

This runs the local dev server against **cloud** Supabase and OpenAI. Useful for
debugging prod data/config without deploying. Remember: you're now touching the real
prod database.

### 3.5 Database iteration loop

```bash
cd apps/web
supabase migration new add_widgets      # creates supabase/migrations/xxxx_add_widgets.sql
# ...write SQL (tables + RLS policies)...
supabase db reset                       # rebuilds local DB from all migrations + seed.sql
```

Alternative: click around in local Studio, then `supabase db diff --schema public` to
generate the migration SQL from what you changed.

Reset is cheap and is the recommended loop — it guarantees your migrations actually
reproduce the schema from scratch, which is exactly what `db push` will do to prod.

---

## 4. What exists in prod right now (as of 2026-07-08)

Snapshot so the rest of the guide has context:

- **Vercel**: project `snorlax-web` (team `zacyauney-3805s-projects`), Root Directory
  `apps/web`, Build Command `pnpm build`, Install Command
  `pnpm install --filter @talysman/web... --frozen-lockfile`, Node 24. Linked from the
  repo root via `.vercel/project.json`. **Not connected to the GitHub repo** — all
  deploys so far were CLI-initiated. All 5 production deploys are currently in Error
  state (being handled separately).
- **Vercel env (production)**: only the Supabase-integration-injected vars exist
  (`POSTGRES_*`, `SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_*`). Everything else the app
  requires (Stripe, Resend, security keys, app URL…) has **not** been pushed yet —
  `config.ts` will fail the build/boot until it is (§6.3).
- **Supabase cloud**: project `lkanoehzgogtrxzycutl`. The local CLI is **not logged in
  and not linked**, so migrations have not been pushed via the CLI from this machine.
- **Domain**: `talysman.app` is added to the Vercel team (registrar/DNS external) but
  needs to be attached to the project and DNS pointed (§6.5).
- **`.credentials`**: `[supabase.dev]`, `[supabase.prod]`, Google, AWS, security keys
  look real; `[resend]` and `[sentry]` still hold example values; Stripe is in test
  mode pointing at the "Talysman sandbox" account.

---

## 5. Prod setup — Supabase side

### 5.1 Link the CLI and push migrations

```bash
cd apps/web
supabase login                                  # opens browser, stores access token
supabase link --project-ref lkanoehzgogtrxzycutl   # asks for the DB password
supabase migration list                         # compare local vs remote history
supabase db push                                # applies pending migrations to prod
```

`db push` applies exactly the files in `supabase/migrations/` that the remote hasn't
seen (tracked in a migration-history table in the remote DB). If you ever change schema
via the cloud dashboard's SQL editor instead, run `supabase db pull` afterwards to
capture it as a migration file — otherwise dev and prod schemas silently drift.

### 5.2 Dashboard configuration (the cloud twin of `config.toml`)

`config.toml` does nothing for the cloud project. Recreate its intent in the dashboard
(`https://supabase.com/dashboard/project/lkanoehzgogtrxzycutl`):

1. **Auth → URL Configuration**
   - Site URL: `https://talysman.app` (the #1 classic mistake is leaving this as
     localhost — it breaks confirmation/reset-email links in prod).
   - Additional redirect URLs:
     - `https://talysman.app/api/auth/callback`
     - `talysman://auth/callback` (desktop deep link)
     - `http://localhost:3000/**` (so `pnpm prod` hybrid mode can log in)
     - optionally `https://*-zacyauney-3805s-projects.vercel.app/**` for Vercel preview
       deploys.
2. **Auth → Providers**: email settings (confirmations are *off* locally; decide
   deliberately for prod). Enable Google here if/when desired — locally it's off in
   `config.toml`.
3. **Auth → Email / SMTP**: default Supabase SMTP is heavily rate-limited; point it at
   Resend SMTP (or accept the limits) once Resend is real.
4. **Settings → API Keys**: this is where the `sb_publishable_...` / `sb_secret_...`
   keys in `[supabase.prod]` come from. (These are the new-style keys — functionally
   equivalent to the legacy `anon`/`service_role` JWTs, which also still exist and are
   what the Vercel integration injected as `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`.
   The app uses the new-style ones via `NEXT_PUBLIC_SUPABASE_ANON_KEY` +
   `SUPABASE_SECRET_KEY`.) To rotate a secret key: create a new one, update
   `.credentials`, re-push env, delete the old.

---

## 6. Prod setup — Vercel side

### 6.1 Project settings (already correct)

Root Directory `apps/web` is what makes the monorepo work: Vercel builds from that
directory, and `outputFileTracingRoot` in `next.config.ts` plus `transpilePackages`
ensure the workspace packages (`@talysman/*`) get bundled into the serverless output.
The filtered install command keeps installs fast by only installing the web app's
dependency subtree.

### 6.2 Decide the deploy trigger: CLI vs Git

Two valid models — pick one and be consistent:

- **CLI deploys (current state)**: `vercel --prod` from the repo root builds on Vercel
  from your local checkout. Simple, no GitHub coupling; but "what's live" isn't tied
  to a commit on `main`, and there are no automatic preview deploys.
- **Git integration (recommended once things stabilize)**: connect the
  `yauneyz/snorlax` repo in Vercel project settings (Settings → Git). Then every push
  to `main` → production deploy; every push to any other branch → preview deploy with
  its own URL. Vercel auto-skips builds when a commit doesn't touch `apps/web` or its
  workspace dependencies (pnpm workspace change detection). Note: your Supabase repo
  contains the desktop/native code too — that's fine, unaffected commits just skip.

Either way, `vercel promote <url>` and `vercel rollback` move the production alias
between existing deployments instantly, without rebuilding.

### 6.3 Environment variables — the full push

The build currently can't succeed because most required vars are absent. The flow:

```bash
cd apps/web
pnpm sync:env:prod         # pushes every non-empty var from .credentials → production env
```

Because `vercel env add` errors on existing vars, on *re*-pushes remove the changed
var(s) first:

```bash
vercel env rm STRIPE_SECRET_KEY production -y
pnpm sync:env:prod         # will now fail on the NEXT existing var… 
```

…which means for anything more than a one-off var change, the practical pattern is:
remove all app-managed vars, then push fresh. A quick loop:

```bash
# from apps/web — removes only vars that sync-env manages (leaves integration vars alone)
for v in $(grep -oE '^\s*\["([A-Z0-9_]+)"' ../../scripts/sync-env.ts | grep -oE '[A-Z0-9_]+'); do
  vercel env rm "$v" production -y 2>/dev/null
done
pnpm sync:env:prod
```

Rules to remember:

- **Env changes only apply to new deployments.** After any change: `vercel --prod`
  (or redeploy from the dashboard).
- `NEXT_PUBLIC_*` values are baked into the client bundle at build time — a redeploy is
  not optional for those, it's the only way they take effect.
- The integration-injected `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  already satisfy the app's Supabase needs on the public side (via the `config.ts`
  fallback); `pnpm sync:env:prod` will additionally push `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  and `SUPABASE_SECRET_KEY` from `.credentials`. Having both is harmless — just make
  sure `[supabase.prod]` in `.credentials` matches the same project the integration is
  linked to, or you'll have two sources of truth disagreeing.
- `sync:env:prod` only populates the **production** environment. If you adopt Git
  preview deploys later, preview builds will fail validation until you either add
  preview values (dashboard or `vercel env add <NAME> preview`) or decide previews
  aren't needed.
- To see what's set: `vercel env ls production`. To mirror prod env into a local file
  for inspection: `vercel env pull --environment=production /tmp/prod.env`.

### 6.4 Verify a deploy

```bash
vercel --prod                       # deploy
curl https://talysman.app/api/health   # liveness (once domain is attached; else use the deployment URL)
```

Then click through login → pricing → checkout with a Stripe test card (while
`[stripe].mode = "test"`), and watch webhook deliveries in the Stripe dashboard.

### 6.5 Domain

```bash
vercel domains ls                        # talysman.app is on the team already
vercel domains add talysman.app snorlax-web    # attach to the project (or dashboard → Domains)
```

Since the registrar/DNS are external, point DNS per what the dashboard tells you —
either an `A` record to `76.76.21.21` + `CNAME www → cname.vercel-dns.com`, or delegate
nameservers to Vercel. Production deploys then automatically get the domain alias.

---

## 7. Prod setup — the third parties

Each of these has a dev half (already working) and a prod half (checklist):

**Stripe** — when the real Talysman account clears verification:
1. Create live products/prices; put the `price_...` ids in `.credentials`
   (`price_id_monthly`/`price_id_yearly` are shared between test/live in the schema —
   they must match whichever mode is active).
2. Dashboard → Webhooks → add endpoint `https://talysman.app/api/stripe/webhook`
   (subscribe to the checkout + customer.subscription events the handler processes);
   copy its `whsec_...` into `webhook_secret_live`.
3. Fill `publishable_key_live`/`secret_key_live`, flip `[stripe].mode = "live"`,
   re-push env (§6.3), redeploy.

**Google OAuth** (Search Console connections) — in the GCP console for the existing
OAuth client, add `https://talysman.app/api/connections/google/callback` as an
authorized redirect URI (the redirect is derived from `NEXT_PUBLIC_APP_URL`, so dev
uses `http://localhost:3000/api/connections/google/callback`).

**Resend** — verify the sending domain in Resend, set a real `api_key` and a real
`from` on that domain in `.credentials` (currently example values), re-push env.

**Sentry / PostHog (optional)** — fill real DSN/org/project/auth-token and PostHog key;
until then the code cleanly disables both (placeholder-detection in `next.config.ts`
and `config.ts`). The Sentry auth token is build-time only (source-map upload).

---

## 8. Runbooks

### Daily dev

```bash
cd apps/web && supabase start        # if not already running (survives reboots via Docker)
pnpm web:dev                         # from repo root
stripe listen --forward-to http://localhost:3000/api/stripe/webhook   # when testing billing
# schema change: supabase migration new x → edit SQL → supabase db reset
supabase stop                        # when done (add --no-backup to wipe data)
```

### Ship a change to prod

```bash
# 1. Schema first (safe: additive migrations deploy before the code that uses them)
cd apps/web && supabase db push

# 2. Env, only if .credentials changed
pnpm sync:env:prod                   # (rm changed vars first — §6.3)

# 3. Code
vercel --prod                        # or `git push origin main` once Git integration is on

# 4. Verify
curl https://talysman.app/api/health
vercel ls                            # confirm ● Ready
```

### Roll back

```bash
vercel ls                            # find the last good deployment URL
vercel rollback                      # or: vercel promote <good-deployment-url>
```

This flips the domain alias instantly (no rebuild). **It does not roll back the
database** — write migrations to be backward-compatible (add columns, don't drop them
in the same release) so old code keeps working against the new schema.

### Check for drift between dev and prod

```bash
cd apps/web
supabase migration list                                   # local vs remote schema history
vercel env pull --environment=production /tmp/prod.env    # then diff against apps/web/.env.local
```

---

## 9. Mental model summary

- **Edit exactly one file for config: `.credentials`.** Everything downstream
  (`.env.local` for web and desktop, Vercel production env) is generated from it.
  Never hand-edit `.env.local` (it says so in its header) and avoid hand-adding Vercel
  vars — otherwise you create a second source of truth.
- **`supabase/config.toml` is local-only; the dashboard is prod config.** Any auth
  setting you rely on locally (redirect URLs, providers, email confirmation behavior)
  must be manually mirrored in the dashboard.
- **Migrations are the only sanctioned path for schema.** Local: `db reset`. Prod:
  `db push`. Dashboard SQL edits require a follow-up `db pull`.
- **Env changes require a redeploy; `NEXT_PUBLIC_*` changes require a rebuild** (which
  a redeploy does). Nothing applies retroactively to a running deployment.
- **Two independent switches**: sync-env mode (which infra) and `[stripe].mode` (which
  Stripe keys). "Prod mode with test Stripe" is the normal state until the live Stripe
  account is ready.
- **Fail-fast everywhere**: sync-env validates `.credentials`; `config.ts` validates
  the runtime env. If prod is misconfigured you find out at build/boot with the exact
  variable named, not from a 3am 500.
