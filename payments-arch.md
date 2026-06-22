# Payments & Auth Architecture

How authentication and payments flow between the **Electron desktop app** (`apps/desktop`)
and the **Next.js web backend** (`apps/web`), and what is required to make it
production-ready.

> Companion to [`snorlax-architecture.md`](./snorlax-architecture.md). This document is
> scoped to auth + billing only.

---

## 1. TL;DR

**Target architecture (what we want):**

- The **web app owns all payment logic**: Stripe Checkout, the Stripe webhook, the billing
  portal, and the subscription database.
- The **Electron app owns nothing about Stripe**. It signs the user in with Supabase and
  then **pings the web server** (`GET /api/desktop/entitlement`) to learn whether the user
  is `free` or `pro`.
- **Both web and desktop authenticate with Supabase.** The web uses Supabase SSR cookies;
  the desktop holds a Supabase session and sends the access token as a bearer token.

**Where we actually are:**

- ✅ The **backend is already built to this design.** Stripe webhook, checkout, portal,
  entitlement endpoint, subscription tables, and bearer-token auth all exist and work.
- ⚠️ The **desktop side is stubbed.** It never signs in, never stores a session, and
  **never calls the backend**. Entitlement is faked locally (a dev-only JSON override, or a
  hard-coded `pro` stub in production builds).

So production work is mostly **connecting the desktop to the backend that already exists** —
not building new billing infrastructure.

```
                 ┌───────────────────────────────────────────────┐
                 │                  Stripe                        │
                 │   Checkout · Subscriptions · Billing Portal    │
                 └───────────────▲───────────────────┬───────────┘
        checkout / portal calls  │                   │ webhook events
                                 │                   ▼
┌──────────────────┐      ┌──────┴───────────────────────────────┐
│  Electron app    │      │            Web app (Next.js)         │
│  apps/desktop    │      │              apps/web                │
│                  │      │  /api/desktop/*   /api/stripe/*       │
│  Supabase session│─────▶│  require-bearer-user  Stripe webhook  │
│  (access token)  │ HTTP │  billing-server (checkout/portal/sync)│
│                  │ bearer                                       │
│  GET /entitlement│◀─────│  getUserEntitlement                   │
└──────────────────┘      └──────────────▲───────────────────────┘
                                         │ SQL (service role)
                                 ┌───────┴────────────────────────┐
                                 │           Supabase             │
                                 │  Auth · profiles ·             │
                                 │  subscriptions · active_subs   │
                                 └────────────────────────────────┘
```

---

## 2. Authentication today

Auth is **Supabase** on both sides. The web app uses cookie/SSR sessions; the desktop app
is meant to hold a Supabase session in the main process and pass a bearer token to the
backend.

### 2.1 Web app (implemented)

- **Clients:** `apps/web/src/lib/supabase/{server,browser,middleware}.ts` build Supabase
  clients for RSCs, the browser, and edge middleware respectively.
- **Session refresh:** `apps/web/src/middleware.ts` + `lib/supabase/middleware.ts` refresh
  the auth cookie on every request.
- **UI:** email/password and Google OAuth in
  `apps/web/src/components/auth/{LoginForm,SignupForm,OAuthButtons}.tsx`.
- **OAuth callback:** `apps/web/src/app/api/auth/callback/route.ts` exchanges the auth code
  for a session (`supabase.auth.exchangeCodeForSession`) and supports redirecting back into
  the desktop app via the `focuslock://` deep link.
- **Guards:**
  - `lib/auth/require-user.ts` — RSC/route guard, redirects to `/login` if unauthenticated.
  - `lib/auth/require-subscribed.ts` — additionally redirects to `/pricing` if the user has
    no active subscription (reads the `active_subscriptions` view).
  - `lib/auth/require-bearer-user.ts` — **the desktop's entry point.** Extracts
    `Authorization: Bearer <token>` and validates it with
    `supabaseAdmin().auth.getUser(token)`.

### 2.2 Desktop → web (the contract exists, the desktop side does not)

- The desktop is expected to send the Supabase **access token** as
  `Authorization: Bearer <jwt>` on every `/api/desktop/*` call.
- Bearer parsing/validation is shared in `packages/auth-contracts/src/index.ts`
  (`extractBearerToken`, `bearerTokenSchema`) and consumed by `require-bearer-user.ts`.

### 2.3 Desktop local session (STUBBED)

The intended design (architecture §10): run `supabase-js` in the **main process** so tokens
never reach the renderer DOM, and persist the refresh token with Electron `safeStorage`
(DPAPI on Windows, Keychain on macOS). Today these are no-ops:

| File | Current behavior |
| --- | --- |
| `apps/desktop/src/main/auth/supabase.ts` | `getAuthStatus()` always returns `{ signedIn: false }`. No Supabase client is created. |
| `apps/desktop/src/main/auth/session.ts` | `loadSession()` returns `null`; `saveSession()` / `clearSession()` do nothing. |

### 2.4 Deep links

Defined in `packages/auth-contracts/src/index.ts`:

- Scheme: `focuslock://`
- `auth/callback` — OAuth return into the desktop app
- `billing/success`, `billing/cancel` — Stripe Checkout return into the desktop app

`desktopDeepLinkUrl(path, params)` builds these URLs; the web routes redirect to them.

---

## 3. Payments today (web backend — fully implemented)

All Stripe logic lives server-side. The Electron bundle only ever sees the **publishable**
key; the secret key, webhook secret, and price IDs are server-only.

### 3.1 Shared billing library

`packages/billing-server/src/index.ts` (Stripe API `2026-05-27.dahlia`) centralizes:

- **`createCheckoutSession`** — finds/creates the user's Stripe customer (stores
  `stripe_customer_id` on `profiles`, with race-condition handling), then creates a
  `mode: 'subscription'` Checkout Session with `client_reference_id = user.id` and
  `subscription_data.metadata.user_id` for webhook resolution.
- **`createPortalSession`** — opens the Stripe billing portal for an existing customer
  (throws `NoStripeCustomerError` if the user never subscribed).
- **`syncSubscription`** — upserts a Stripe subscription into the `subscriptions` table
  (status, price, period dates, trial, cancellation). `resolveUserId` derives the user from
  subscription metadata → customer metadata → `profiles.stripe_customer_id` lookup.
- **`getUserEntitlement`** — reads the `active_subscriptions` view and returns an
  `Entitlement`. `pro` if an active/trialing subscription exists, else `free`. It stamps
  `fetchedAt` and `cacheUntil` (default TTL **5 min**) so the client can cache and survive
  brief offline periods.

### 3.2 Web checkout / portal routes (cookie auth)

- `POST /api/stripe/checkout` — `requireUser`, body `{ price: 'monthly' | 'yearly' }`,
  returns the Checkout URL.
- `GET /api/stripe/checkout/success` — verifies `client_reference_id === user.id`, calls
  `syncSubscription` (fast path), redirects to `/app?checkout=success`.
- `POST /api/stripe/portal` — returns the portal URL.

### 3.3 Desktop checkout / portal / entitlement routes (bearer auth)

`apps/web/src/app/api/desktop/*` — same logic as the web routes, but authenticated with
`requireBearerUser` and redirecting to `focuslock://` deep links:

| Route | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/api/desktop/entitlement` | GET | bearer | Returns the `Entitlement` JSON (`getUserEntitlement`). |
| `/api/desktop/checkout` | POST | bearer | `{ price }` → Stripe Checkout URL. |
| `/api/desktop/checkout/success` | GET | none | Syncs subscription, redirects to `focuslock://billing/success`. |
| `/api/desktop/checkout/cancel` | GET | none | Redirects to `focuslock://billing/cancel`. |
| `/api/desktop/portal` | POST | bearer | Stripe billing portal URL. |

### 3.4 Stripe webhook (source of truth)

`apps/web/src/app/api/stripe/webhook/route.ts` (Node runtime, raw body + signature
verification with `STRIPE_WEBHOOK_SECRET`):

- Handles `checkout.session.completed`,
  `customer.subscription.{created,updated,deleted,paused,resumed}`,
  `invoice.payment_failed`, `charge.refunded`.
- Calls `syncSubscription` to mirror Stripe state into Supabase.
- **Idempotent** via a `stripe_events` dedup ledger.
- Sends transactional email (Resend) for payment failure / cancellation / refund.

The success-redirect sync in §3.2/§3.3 is a best-effort fast path; **the webhook is the
authoritative sync.**

### 3.5 Database schema (`apps/web/supabase/migrations/`)

- **`profiles`** — `id` (→ `auth.users`), `email`, `full_name`, `avatar_url`,
  `stripe_customer_id` (unique). Auto-created by trigger on signup. RLS: owner read/update.
- **`subscriptions`** — PK = Stripe subscription id; `user_id`, `status` (enum), `price_id`,
  `quantity`, `cancel_at_period_end`, period/trial/cancel timestamps. RLS: owner read-only;
  **only the service role (webhook) writes.**
- **`active_subscriptions`** (view) — subscriptions that are `trialing`/`active` and not yet
  past `current_period_end`. This is the single read used for entitlement.
- **`stripe_events`** — processed webhook event ids (dedup).

### 3.6 Environment variables

| Variable | Visibility | Used by |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `…PUBLISHABLE_KEY` (web), `VITE_SUPABASE_URL` / `…ANON_KEY` (desktop) | **client** | Supabase clients |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `VITE_STRIPE_PUBLISHABLE_KEY` | **client** | display only |
| `SUPABASE_SECRET_KEY` | server-only | `supabaseAdmin()` |
| `STRIPE_SECRET_KEY` | server-only | all Stripe API calls |
| `STRIPE_WEBHOOK_SECRET` | server-only | webhook signature |
| `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY` | server-only | checkout line items |
| `STRIPE_MODE` (`test`/`live`), `STRIPE_PORTAL_CONFIG_ID` | server-only | mode/portal config |
| `API_BASE_URL` | client (desktop) | base URL the desktop will call (see §6) |

Config is validated at startup in `apps/web/src/lib/config.ts` (Zod, fail-fast,
public/server split). Local secrets come from `.credentials` → `pnpm sync:env`.

---

## 4. Entitlement on the desktop today (STUBBED)

The renderer shows plan-gated UI based on an `Entitlement`, but that entitlement **never
comes from the server**.

- **`apps/desktop/src/main/auth/subscription.ts`** — `getEntitlement()`:
  - In **development**: reads/writes `dev-entitlement.json` in `userData`; default plan
    `pro`; can be flipped from the Settings page.
  - In **production**: returns a **hard-coded `pro` stub**. No network call.
  - It also **redefines its own `Entitlement` type** with a narrower `source` union
    (`'stub' | 'dev-override' | 'edge-function' | 'cache'`) instead of importing the
    canonical schema from `@focuslock/product`, and pulls a desktop-local
    `shared/productLimits.js` copy of the plan limits.
- **IPC surface** (`apps/desktop/src/main/ipc/handlers.ts`):
  - `app:entitlement` — returns the current entitlement snapshot.
  - `app:devSetEntitlementPlan` — dev-only plan override.
  - Free-tier limits are enforced at the IPC boundary on `setPolicy` / `setSchedule`
    (blacklist/block-all only, ≤ 5 domains, no apps, no scheduling).
- **Canonical contract** (`packages/product/src/index.ts`): `entitlementSchema`
  (`active`, `plan`, `source`, optional `status`/`currentPeriodEnd`/`fetchedAt`/`cacheUntil`),
  `limitsForPlan`, and the validation/constraint helpers the IPC layer should use.

So both the **type** and the **plan-limit table** are duplicated between desktop and the
shared package — a correctness risk once real entitlements flow.

---

## 5. End-to-end flows

### 5.1 Sign-in (target)

1. Renderer asks main to sign in → main opens the system browser to Supabase OAuth.
2. After consent, Supabase redirects to `/api/auth/callback`, which redirects to
   `focuslock://auth/callback?code=…`.
3. The desktop's deep-link handler receives the code, calls `exchangeCodeForSession`, and
   persists the refresh token via `safeStorage`.
4. `getAuthStatus()` now reports `{ signedIn: true, email }`.

> **Today:** none of this runs — `getAuthStatus()` is hard-coded to `signedIn: false`.

### 5.2 Upgrade / checkout (target)

1. Renderer "Upgrade" → main `POST /api/desktop/checkout` with the bearer token and
   `{ price }`.
2. Backend returns a Stripe Checkout URL; main opens it in the external browser.
3. User pays; Stripe redirects to `/api/desktop/checkout/success`, which calls
   `syncSubscription` and redirects to `focuslock://billing/success`.
4. Desktop handles the deep link and **refreshes entitlement** (§5.4).

> **Today:** the Upgrade button calls the dev-only `devSetEntitlementPlan`; no Stripe.

### 5.3 Webhook sync (already real)

Stripe → `/api/stripe/webhook` → `syncSubscription` → `subscriptions` table. Authoritative,
idempotent, and independent of whether the user's browser completed the redirect.

### 5.4 Entitlement refresh (target)

1. Main `GET /api/desktop/entitlement` with the bearer token.
2. `getUserEntitlement` reads `active_subscriptions` and returns
   `{ active, plan, source: 'server', status?, currentPeriodEnd?, fetchedAt, cacheUntil }`.
3. Main caches it (honoring `cacheUntil`) and pushes it to the renderer via
   `app:entitlement`; limits are re-applied.

> **Today:** step 1–2 don't happen; the renderer gets the local stub.

---

## 6. Gap analysis

| Concern | Target | Current state |
| --- | --- | --- |
| Desktop auth | Real Supabase session in main process | `getAuthStatus()` → `signedIn: false` (stub) |
| Token storage | Refresh token in `safeStorage` | `session.ts` no-ops |
| Entitlement source | `GET /api/desktop/entitlement` over bearer token | Local JSON / hard-coded `pro` stub, no HTTP |
| Offline behavior | Cache `cacheUntil`, fail **closed** (last-known/free) | No cache; always returns `pro` |
| Type/limits sharing | Import `@focuslock/product` everywhere | Desktop redefines `Entitlement` + copies `productLimits` |
| Checkout / portal | Desktop calls `/api/desktop/{checkout,portal}` | Upgrade button uses dev override |
| Entitlement transport | Next.js `/api/desktop/*` web routes | Env/docs still reference Supabase **Edge Functions** (`functions/v1`) — unused |
| Stripe mode | Live keys, live webhook | Test placeholders |

---

## 7. Changes / upgrades for production

Grouped by area, with the concrete files to touch. The backend already exists, so most of
this is desktop wiring plus go-live hardening.

### A. Wire desktop Supabase auth (main process)

- **`apps/desktop/src/main/auth/supabase.ts`** — instantiate a real `supabase-js` client
  from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. Expose `signIn` (open external
  browser → OAuth → `focuslock://auth/callback` → `exchangeCodeForSession`), `signOut`, and
  back `getAuthStatus()` with the live session. Keep it in the **main process** so tokens
  never touch the renderer DOM.
- **`apps/desktop/src/main/auth/session.ts`** — persist the refresh token with Electron
  `safeStorage`; load it on startup; auto-refresh the access token; clear on sign-out.
- **`apps/desktop/src/main/window.ts`** — confirm the deep-link handler routes
  `auth/callback` (and `billing/*`) and that the `focuslock://` scheme is registered for
  packaged builds.
- Expose only `{ signedIn, email }` to the renderer via the preload bridge — never the raw
  token.

### B. Make entitlement a real server call

- **`apps/desktop/src/main/auth/subscription.ts`** — replace the stub with
  `GET {API_BASE_URL}/api/desktop/entitlement`, sending `Authorization: Bearer <accessToken>`.
- **Standardize the base URL on the Next.js web server.** Drop the Supabase Edge Function
  assumption: update `API_BASE_URL` in `.env.development` / `.env.production` /
  `.env.example` to the web origin (e.g. `https://app.snorlax…`), and fix the
  edge-function references in `snorlax-architecture.md`.
- **Cache + offline grace:** store the returned entitlement and honor `cacheUntil` /
  `fetchedAt`. On network failure, serve the cached value (source `'cache'` / `'offline'`)
  until it expires, then **fail closed** toward the last-known plan (or `free`) — never
  unlock the blocker because a request failed. This matches the product's anti-bypass
  posture.
- **Kill the duplication:** delete the desktop's local `Entitlement` type and
  `shared/productLimits.js` copy; import `entitlementSchema` and `limitsForPlan` from
  `@focuslock/product` so client and server share one contract. Validate the HTTP response
  with `entitlementSchema.parse`.

### C. Checkout & portal from the desktop

- Wire the "Upgrade to Pro" button (`apps/desktop/src/renderer/pages/Plans.tsx`) to
  `POST /api/desktop/checkout` → open the returned URL externally.
- Handle `focuslock://billing/success` and `…/cancel` deep links → trigger an entitlement
  refresh (§B) so the UI updates immediately.
- Wire "Manage billing" (`Account.tsx`) to `POST /api/desktop/portal`.

### D. Production hardening (backend + shared)

- **Stripe live mode:** create live products/prices, set live `STRIPE_PRICE_*`, register the
  live webhook endpoint + `STRIPE_WEBHOOK_SECRET`, switch `STRIPE_MODE=live`. Re-verify
  webhook idempotency under Stripe retries (the `stripe_events` ledger covers this).
- **JWT/token expiry on desktop:** refresh the access token before calls; on `401`, refresh
  once and retry; allow some clock-skew tolerance on `cacheUntil`.
- **`/api/desktop/*` abuse protection:** add rate limiting and confirm Sentry coverage on
  every desktop route (entitlement already reports to Sentry).
- **Secrets hygiene:** verify the Electron bundle ships only publishable/anon keys — no
  `STRIPE_SECRET_KEY`, `SUPABASE_SECRET_KEY`, or `STRIPE_WEBHOOK_SECRET`.
- **Packaging:** confirm `electron-builder.yml` registers the `focuslock://` protocol on all
  target OSes so deep links resolve in installed builds.

### E. Open decisions (flag, not blockers)

- One canonical value for `API_BASE_URL` (web origin) across all envs.
- Whether to keep *any* Supabase Edge Function path, or commit fully to Next.js routes
  (recommended: Next.js only, matching the stated goal).
- How aggressive the offline fail-closed window should be (TTL is server-set to 5 min today;
  decide the desktop's hard cutoff after `cacheUntil`).

---

## 8. File reference

**Backend (implemented):**
- Auth guards: `apps/web/src/lib/auth/{require-user,require-subscribed,require-bearer-user}.ts`
- OAuth callback: `apps/web/src/app/api/auth/callback/route.ts`
- Desktop routes: `apps/web/src/app/api/desktop/{entitlement,checkout,checkout/success,checkout/cancel,portal}/route.ts`
- Stripe routes: `apps/web/src/app/api/stripe/{checkout,checkout/success,portal,webhook}/route.ts`
- Billing logic: `packages/billing-server/src/index.ts`
- Schema: `apps/web/supabase/migrations/0001_init.sql` (+ `0003_stripe_events.sql`)
- Config: `apps/web/src/lib/config.ts`

**Shared contracts:**
- `packages/product/src/index.ts` (entitlement + limits — canonical)
- `packages/auth-contracts/src/index.ts` (bearer + deep links)

**Desktop (stubbed — to wire):**
- `apps/desktop/src/main/auth/{supabase,session,subscription}.ts`
- `apps/desktop/src/main/ipc/handlers.ts`, `channels.ts`
- `apps/desktop/src/renderer/pages/{Plans,Account,Settings}.tsx`
- `apps/desktop/src/renderer/store/useFocusStore.ts`
