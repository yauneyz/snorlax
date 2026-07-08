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

**Where we are now:**

- ✅ The **backend is built to this design.** Stripe webhook, checkout, portal,
  entitlement endpoint, subscription tables, and bearer-token auth all exist and work.
- ✅ The **desktop is wired to it.** The main process runs a Supabase client (Google
  browser-OAuth + in-app email/password), persists the session with `safeStorage`, and calls
  `/api/desktop/{entitlement,checkout,portal}` with a bearer token. A dev-only override
  remains for exercising gated UI without a real subscription.

The remaining work is **go-live hardening** (Stripe live mode, Supabase redirect allow-list,
abuse protection) — covered in §7.

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
  the desktop app via the `talysman://` deep link.
- **Guards:**
  - `lib/auth/require-user.ts` — RSC/route guard, redirects to `/login` if unauthenticated.
  - `lib/auth/require-subscribed.ts` — additionally redirects to `/pricing` if the user has
    no active subscription (reads the `active_subscriptions` view).
  - `lib/auth/require-bearer-user.ts` — **the desktop's entry point.** Extracts
    `Authorization: Bearer <token>` and validates it with
    `supabaseAdmin().auth.getUser(token)`.

### 2.2 Desktop → web (wired)

- The desktop sends the Supabase **access token** as `Authorization: Bearer <jwt>` on every
  `/api/desktop/*` call (`getAccessToken()` in `apps/desktop/src/main/auth/supabase.ts`).
- Bearer parsing/validation is shared in `packages/auth-contracts/src/index.ts`
  (`extractBearerToken`, `bearerTokenSchema`) and consumed by `require-bearer-user.ts`.

### 2.3 Desktop local session (implemented)

`supabase-js` runs in the **main process** so tokens never reach the renderer DOM; the
session is persisted with Electron `safeStorage` (DPAPI on Windows, Keychain on macOS).

| File | Behavior |
| --- | --- |
| `apps/desktop/src/main/auth/supabase.ts` | PKCE client; `getAuthStatus` / `getAccessToken`, `signInWithGoogle` (browser OAuth), `signInWithPassword`, `completeOAuth`, `signOut`; `onAuthStateChange` broadcasts to renderers. |
| `apps/desktop/src/main/auth/session.ts` | `safeStorage`-encrypted storage adapter handed to supabase-js (persists session + PKCE verifier); falls back to an unencrypted file with a warning if OS encryption is unavailable. |

The renderer only ever receives `{ signedIn, email }` — never the raw token. Sign-in UX
(Account page) offers both **Sign in with Google** (system browser) and an in-app
**email/password** form.

### 2.4 Deep links

Defined in `packages/auth-contracts/src/index.ts`:

- Scheme: `talysman://`
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
`requireBearerUser` and redirecting to `talysman://` deep links:

| Route | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/api/desktop/entitlement` | GET | bearer | Returns the `Entitlement` JSON (`getUserEntitlement`). |
| `/api/desktop/checkout` | POST | bearer | `{ price }` → Stripe Checkout URL. |
| `/api/desktop/checkout/success` | GET | none | Syncs subscription, redirects to `talysman://billing/success`. |
| `/api/desktop/checkout/cancel` | GET | none | Redirects to `talysman://billing/cancel`. |
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
| `NEXT_PUBLIC_SUPABASE_URL` / `…ANON_KEY` (web), `VITE_SUPABASE_URL` / `…ANON_KEY` (desktop) | **client** | Supabase clients |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `VITE_STRIPE_PUBLISHABLE_KEY` | **client** | display only |
| `SUPABASE_SECRET_KEY` | server-only | `supabaseAdmin()` |
| `STRIPE_SECRET_KEY` | server-only | all Stripe API calls |
| `STRIPE_WEBHOOK_SECRET` | server-only | webhook signature |
| `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY` | server-only | checkout line items |
| `STRIPE_MODE` (`test`/`live`), `STRIPE_PORTAL_CONFIG_ID` | server-only | mode/portal config |
| `API_BASE_URL` | client (desktop) | Next.js web origin the desktop calls (e.g. `http://localhost:3000`) |

Config is validated at startup in `apps/web/src/lib/config.ts` (Zod, fail-fast,
public/server split). Local secrets come from `.credentials` → `pnpm sync:env`.

---

## 4. Entitlement on the desktop (implemented)

The renderer shows plan-gated UI based on an `Entitlement` that now comes from the server.

- **`apps/desktop/src/main/auth/subscription.ts`** — `getEntitlement()`:
  - In **production**: `GET {API_BASE_URL}/api/desktop/entitlement` with the bearer access
    token; the result is validated with `entitlementSchema` and cached to
    `entitlement-cache.json` in `userData`. No token → `free`/inactive.
  - **Local release override:** `pnpm run release:local` embeds a local Ed25519 public key and
    writes a signed `~/.config/talysman/local-entitlement.json` granting Pro for the current
    Linux user/hostname. Production desktop builds trust that file before the network only when
    the matching public key was embedded at build time; the private key stays outside the app.
  - **Offline:** while signed in, the last-known cached entitlement is served **indefinitely**
    (`source: 'offline'`); re-evaluation happens on the next successful online call. (Focus
    enforcement is independent — native service + USB-key gate — so entitlement is feature
    gating only and must not strip a paying user's features over a network blip.)
  - In **development**: still reads/writes `dev-entitlement.json` (default `pro`) so gated UI
    can be exercised without a subscription (Settings/Plans dev switch).
  - The desktop now imports the canonical `Entitlement` / `entitlementSchema` /
    `entitlementForPlan` from `@talysman/product` — no local type copy.
- **`apps/desktop/src/main/auth/billing.ts`** — `startCheckout(price)` →
  `POST /api/desktop/checkout`; `openBillingPortal()` → `POST /api/desktop/portal`; both open
  the returned Stripe URL with `shell.openExternal`.
- **IPC surface** (`apps/desktop/src/main/ipc/{channels,handlers}.ts`):
  - `app:entitlement`, `app:authStatus`; `app:signInGoogle` / `app:signInPassword` /
    `app:signOut`; `app:startCheckout` / `app:openBillingPortal`; `app:devSetEntitlementPlan`
    (dev-only); and an `app:event` push (`authChanged` / `entitlementChanged`) so renderers
    re-pull after sign-in/out and billing deep-link returns.
  - Free-tier limits are enforced at the IPC boundary on `setPolicy` / `setSchedule`
    (blacklist/block-all only, ≤ 5 domains, no apps, no scheduling).
- **Canonical contract** (`packages/product/src/index.ts`): `entitlementSchema`
  (`active`, `plan`, `source`, optional `status`/`currentPeriodEnd`/`fetchedAt`/`cacheUntil`),
  `limitsForPlan`, and the validation/constraint helpers — shared by client and server. The
  `source` enum is `stub | dev-override | server | cache | offline` (no `edge-function`).

---

## 5. End-to-end flows

### 5.1 Sign-in

- **Google (browser OAuth):** renderer → `app:signInGoogle` → main builds the PKCE auth URL
  (`redirectTo: talysman://auth/callback`) and opens the system browser. Supabase redirects
  to `talysman://auth/callback?code=…`; the desktop deep-link handler calls
  `completeOAuth(code)` (`exchangeCodeForSession`) and persists the session via `safeStorage`.
- **Email/password:** renderer form → `app:signInPassword` → `supabase.auth.signInWithPassword`.
- Either way, `onAuthStateChange` fires `app:event('authChanged')`; the renderer re-pulls auth
  status + entitlement, and `getAuthStatus()` reports `{ signedIn: true, email }`.

### 5.2 Upgrade / checkout

1. Renderer "Upgrade — Monthly/Yearly" → `app:startCheckout` → main
   `POST /api/desktop/checkout` (bearer) → Stripe Checkout URL → `shell.openExternal`.
2. User pays; Stripe redirects to `/api/desktop/checkout/success`, which calls
   `syncSubscription` and redirects to `talysman://billing/success`.
3. The deep-link handler emits `app:event('entitlementChanged')`; the renderer refreshes and
   the plan flips to **Pro**.

### 5.3 Webhook sync (authoritative)

Stripe → `/api/stripe/webhook` → `syncSubscription` → `subscriptions` table. Idempotent and
independent of whether the user's browser completed the redirect.

### 5.4 Entitlement refresh

1. Main `GET /api/desktop/entitlement` with the bearer token.
2. `getUserEntitlement` reads `active_subscriptions` and returns
   `{ active, plan, source: 'server', status?, currentPeriodEnd?, fetchedAt, cacheUntil }`.
3. Main caches it to disk and the renderer applies plan limits. Offline → last-known cache is
   served with `source: 'offline'`.

---

## 6. Status

| Concern | Target | State |
| --- | --- | --- |
| Desktop auth | Real Supabase session in main process | ✅ PKCE client; Google + email/password |
| Token storage | Session in `safeStorage` | ✅ encrypted storage adapter |
| Entitlement source | `GET /api/desktop/entitlement` over bearer token | ✅ implemented + disk cache |
| Offline behavior | Keep last-known while signed in | ✅ indefinite, `source: 'offline'` |
| Type/limits sharing | Import `@talysman/product` everywhere | ✅ no local copy |
| Checkout / portal | Desktop calls `/api/desktop/{checkout,portal}` | ✅ via `billing.ts` |
| Entitlement transport | Next.js `/api/desktop/*` web routes | ✅ `API_BASE_URL` = web origin; edge-fn refs removed |
| Stripe mode | Live keys, live webhook | ⏳ go-live hardening (§7) |

---

## 7. Remaining work for production

The desktop↔backend wiring is done (§2–§5). What's left is go-live hardening and
environment/config setup that can't be done from code alone.

### A. Stripe + Supabase go-live config

- **Stripe live mode:** create live products/prices, set live `STRIPE_PRICE_*`, register the
  live webhook endpoint + `STRIPE_WEBHOOK_SECRET`, switch `STRIPE_MODE=live`. Webhook
  idempotency under retries is already covered by the `stripe_events` ledger.
- **Supabase redirect allow-list:** add `talysman://auth/callback` to the project's allowed
  redirect URLs (local `supabase/config.toml` `additional_redirect_urls` **and** the hosted
  project) — otherwise the OAuth round-trip can't complete. Enable the **Google** provider.
- **`API_BASE_URL` per env:** set to the deployed Next.js origin in `.env.production`
  (`.env.development` already points at `http://localhost:3000`).

### B. Desktop robustness

- **Token expiry:** supabase-js auto-refreshes via the `safeStorage` adapter; on a `401` from
  `/api/desktop/*`, the entitlement path treats the user as signed-out. Consider an explicit
  refresh-and-retry on `401` for checkout/portal too.
- **Packaging:** confirm `electron-builder.yml` registers the `talysman://` protocol on all
  target OSes so deep links resolve in installed builds (registration code is in
  `index.ts`/`window.ts`; the manifest side is build config).

### C. Backend hardening

- **`/api/desktop/*` abuse protection:** add rate limiting; Sentry coverage already present on
  the desktop routes.
- **Secrets hygiene:** the Electron bundle ships only publishable/anon keys (`__APP_CONFIG__`
  carries `API_BASE_URL` + `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`); secret/webhook
  keys stay server-only. Worth a CI check.

### D. Decided this iteration

- **Transport:** Next.js `/api/desktop/*` only; the Supabase Edge Function path was removed
  from env + docs.
- **Sign-in:** both Google browser-OAuth (PKCE) and in-app email/password.
- **Offline:** keep the last-known entitlement **indefinitely while signed in** (the USB-key
  disable gate, not entitlement, is the anti-bypass control).

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

**Desktop (wired):**
- `apps/desktop/src/main/auth/{supabase,session,subscription,billing}.ts`
- `apps/desktop/src/main/ipc/{handlers,channels}.ts`, `main/window.ts`, `main/index.ts`
- `apps/desktop/src/main/config.ts`, `electron.vite.config.ts`, `src/main/env.d.ts`
- `apps/desktop/src/preload/index.ts`, `renderer/lib/bridge.ts`
- `apps/desktop/src/renderer/pages/{Plans,Account}.tsx`, `renderer/store/useFocusStore.ts`
