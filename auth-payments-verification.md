# Auth + Payments Verification Guide

How to verify the native desktop auth flows (sign-up, sign-in, password reset, logout)
and the payments lifecycle (checkout, subscription detail, cancel/resume, portal,
entitlement) end-to-end, in **dev** and **prod**. Written for the July 2026 change that
moved sign-up, password reset, and subscription management natively into the Electron
app.

---

## 1. The moving parts

Understand these before testing — most "bugs" during verification turn out to be one of
these pieces misconfigured.

### Desktop app (`apps/desktop`)

| Part | File(s) | What it does |
|---|---|---|
| Main-process Supabase client | `src/main/auth/supabase.ts` | Owns ALL auth. PKCE flow, anon key only. Sign-in (Google/password), sign-up, reset request, password update, sign-out. Renderer never sees tokens. |
| Encrypted session store | `src/main/auth/session.ts` | Persists the Supabase session + PKCE code verifier to `supabase-auth.bin` in userData, encrypted via `safeStorage`. **The PKCE verifier living here is why email links only work on the machine that requested them.** |
| Billing client | `src/main/auth/billing.ts` | Bearer-token calls to the web `/api/desktop/*` routes. Checkout/portal open a browser; subscription detail/cancel/resume are pure API calls. |
| Entitlement resolution | `src/main/auth/subscription.ts` | Order: dev override → signed local license → server (`/api/desktop/entitlement`) → offline disk cache. Caches to `entitlement-cache.json`. |
| Deep-link handler | `src/main/window.ts` (`handleDeepLink`) | Routes `talysman://auth/callback`, `talysman://auth/reset-callback`, `talysman://billing/success|cancel`. Registered in `src/main/index.ts` (second-instance on Win/Linux, open-url on macOS, cold-start argv). |
| Password-recovery flag | `supabase.ts` (`passwordRecoveryPending`) | Set by the reset-callback deep link, cleared by `updatePassword`/sign-out. Renderer **polls** it via `authStatus` — this is what survives cold-start deep links. |
| IPC surface | `src/main/ipc/channels.ts` + `src/preload/index.ts` + `src/renderer/lib/bridge.ts` | Channel names duplicated in three places. If a button silently does nothing, check these are in sync. |
| Account UI | `src/renderer/pages/Account.tsx` | Sub-view state machine: signin / signup / forgot / checkEmail, recovery form override, subscription detail + cancel/resume. |
| Config injection | `src/main/config.ts` via `__APP_CONFIG__` in `electron.vite.config.ts` | `API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `LOCAL_ENTITLEMENT_PUBLIC_KEY`. |

### Web app (`apps/web`)

| Part | File(s) | What it does |
|---|---|---|
| Desktop bearer API | `src/app/api/desktop/{checkout,portal,entitlement,subscription,subscription/cancel,subscription/resume}` | All guarded by `requireBearerUser` (validates the desktop's access token via `supabaseAdmin().auth.getUser`). |
| Checkout return trip | `src/app/api/desktop/checkout/{success,cancel}` | Stripe redirects here; success syncs the subscription then 302s to `talysman://billing/success`. |
| Stripe webhook | `src/app/api/stripe/webhook/route.ts` | **The authoritative writer of subscription state.** Signature-verified, deduped via `stripe_events`. Sends Resend emails on payment-failed / **deleted** (not on cancel-at-period-end) / refund. |
| Billing brain | `packages/billing-server/src/index.ts` | `createCheckoutSession`, `createPortalSession`, `syncSubscription`, `getUserEntitlement`, `getSubscriptionDetail`, `setCancelAtPeriodEnd`. |
| Web auth pages | `/login`, `/signup`, `/forgot-password`, `/reset-password` | The cross-device fallback for email links. Must keep working. |
| DB | `supabase/migrations/0001_init.sql` | `profiles` (auto-created by `handle_new_user` trigger, copies `full_name`), `subscriptions` (service-role-write-only under RLS), `active_subscriptions` view. |

### External services

- **Supabase**: auth (users, sessions, email sending, redirect-URL allow-list), Postgres, RLS.
- **Stripe**: checkout, billing portal, subscription objects, webhook events.
  Dev/test uses the **"Talysman sandbox"** account; the real Talysman account is separate.
- **Resend**: transactional emails triggered by the webhook (payment failed, cancelled, refund). Server-side only.

---

## 2. Environment setup

### Dev stack (everything local)

```sh
# 1. Local Supabase (Postgres + auth + Inbucket email catcher)
cd apps/web && supabase start          # Inbucket UI: http://localhost:54324

# 2. Web app
pnpm dev                                # http://localhost:3000

# 3. Stripe webhook forwarding (sandbox account)
stripe listen --forward-to localhost:3000/api/stripe/webhook
# put the printed whsec_... into STRIPE_WEBHOOK_SECRET

# 4. Desktop app (separate terminal)
cd apps/desktop && pnpm dev
# needs API_BASE_URL=http://localhost:3000, VITE_SUPABASE_URL/ANON_KEY from `supabase status`
```

**⚠ Dev gotcha — the entitlement override.** Non-production desktop builds short-circuit
`getEntitlement()` with `dev-entitlement.json` (default plan: **pro**, source
`dev-override`). This masks the real server entitlement path. To test the true
server flow in dev, either use the dev plan switcher to set `free` and watch the
**subscription detail** card instead (it always hits the server), or temporarily test
with a production-env build. The subscription detail endpoint is NOT affected by the
override — only the entitlement/plan-limits path is.

### Prod prerequisites (config checklist — do these BEFORE testing)

Supabase dashboard (production project):
- [ ] Auth → URL Configuration → Redirect URLs contains **`talysman://auth/callback`**,
      **`talysman://auth/reset-callback`**, `https://talysman.app/api/auth/callback`,
      and `https://talysman.app/reset-password`.
- [ ] Site URL = `https://talysman.app`.
- [ ] Decide + note the **email confirmation** setting (Auth → Providers → Email →
      "Confirm email"). Both modes are supported by the app; know which one you're testing.
- [ ] Email templates (Confirm signup, Reset password) still use the default
      `{{ .ConfirmationURL }}` so `redirect_to` is honored.
- [ ] Google provider enabled with prod OAuth credentials.

Stripe dashboard (the correct account for the environment — sandbox for staging tests,
real Talysman account for prod once verified):
- [ ] Webhook endpoint `https://talysman.app/api/stripe/webhook` subscribed to:
      `checkout.session.completed`, `customer.subscription.created/updated/deleted/paused/resumed`,
      `invoice.payment_failed`, `charge.refunded`; its signing secret matches
      `STRIPE_WEBHOOK_SECRET` in Vercel.
- [ ] `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY` point at live prices in the same account
      as `STRIPE_SECRET_KEY`. (A price/key account mismatch fails checkout with an obscure error.)
- [ ] Billing portal configuration exists; `STRIPE_PORTAL_CONFIG_ID` set if using a custom one.

Vercel env (production): `NEXT_PUBLIC_APP_URL=https://talysman.app`, Supabase URL +
publishable + secret keys, all `STRIPE_*`, `RESEND_API_KEY`.

Desktop production build config: `API_BASE_URL=https://talysman.app`, prod
`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`.

> **Note (as of 2026-07):** talysman.app is not deployed yet and the real Stripe account
> is pending verification. "Prod" testing until then means: deployed Vercel preview/prod
> URL + production Supabase project + Stripe sandbox. Re-run §5 payments tests once the
> real Stripe account is live.

---

## 3. Automated checks (run first, both before and after any config change)

```sh
pnpm typecheck                                   # root: packages + desktop
cd apps/web && pnpm typecheck && pnpm lint
pnpm vitest run                                  # root: 75 tests incl. signUpResult.test.ts
cd apps/web && pnpm vitest run                   # 48 tests incl. subscription-detail.test.ts
cd apps/desktop && pnpm build                    # catches bundler/preload drift
```

---

## 4. Auth flow tests

Legend: **[D]** = dev stack, **[P]** = prod. Run everything in both unless marked.

### 4.1 Sign-up — instant session (email confirmations OFF) [D, P if confirmations off]

1. Desktop → Account → "Create account". Enter full name, new email, password ≥ 8 chars.
2. **Expect:** immediately signed in (badge shows email); no browser involved.
3. Check DB: `profiles` row exists with `full_name` populated (the `handle_new_user` trigger).
4. Password < 8 chars → inline error, no request sent.
5. Sign up again with the same email → "An account with this email already exists — try
   signing in." (This is the obfuscated `identities: []` response — if you instead get
   silently sent to "check your email", the classifier broke.)

### 4.2 Sign-up — confirmation required (email confirmations ON) [D via config flip, P if confirmations on]

Dev: set `enable_confirmations = true` under `[auth.email]` in `apps/web/supabase/config.toml`,
`supabase stop && supabase start`.

1. Desktop sign-up → **Expect:** "We sent a confirmation link to {email}. Open it on this
   computer…" view.
2. Open the email (dev: Inbucket at `localhost:54324`; prod: real inbox). Click the link.
3. **Expect:** browser bounces to `talysman://auth/callback?code=…`, the OS asks to open
   Talysman (first time), the app foregrounds **signed in**.
4. Repeat with the app **fully quit** before clicking the link (cold-start deep link):
   app must launch and end up signed in.
5. Click the same link a second time → friendly error mentioning the same-computer
   requirement, not a crash.
6. Open the link on a **different device** → expected failure (PKCE verifier is on the
   original machine); the message should point at the website.

### 4.3 Sign-in [D, P]

- Email/password: correct → signed in; wrong password → inline Supabase error.
- Google: opens system browser → account chooser → redirects to `talysman://auth/callback`
  → app signed in. Also verify a **first-time** Google identity creates a `profiles` row.
- Restart the app while signed in → still signed in (encrypted session restore). On Linux
  check the log for the `safeStorage` plaintext-fallback warning — if it appears, session
  encryption is not active on that machine.

### 4.4 Password reset — native [D, P]

1. Account → "Forgot password?" → enter email → **Expect** the non-committal copy
   ("If an account exists…") whether or not the email exists.
2. Open the reset email, click the link → `talysman://auth/reset-callback?code=…` → app
   foregrounds showing **"Choose a new password"** (the route is forced to Account).
3. Mismatched confirm or < 8 chars → inline error, nothing sent.
4. Submit a valid new password → back to normal signed-in Account view.
5. Sign out → old password fails, new password works.
6. **Cold start:** quit the app before clicking the reset link → app launches directly
   into the recovery form.
7. **Abandonment:** trigger recovery, then sign out without setting a password → recovery
   form is gone (flag cleared); sign back in normally.
8. Expired/re-used reset link → friendly error, app still usable.

### 4.5 Password reset — web fallback [D, P]

`/forgot-password` on the website → email link → `/reset-password` page → new password
works. This is the cross-device path and must keep working — it uses the browser's own
PKCE verifier, independent of the desktop.

### 4.6 Logout [D, P]

Sign out → badge flips to "not signed in", plan gates re-apply (free limits), subscription
detail disappears, and `supabase-auth.bin` no longer restores a session on restart.

---

## 5. Payments flow tests

Use Stripe test card `4242 4242 4242 4242` (any future expiry / CVC) on the sandbox.
Watch three surfaces simultaneously: the **desktop Account page**, the **Stripe dashboard**
(subscription object), and the **`subscriptions` table** in Supabase.

### 5.1 Checkout [D, P]

1. Signed in, free plan → Plans → Monthly (then repeat Yearly on a second account).
2. Browser opens Stripe Checkout. Complete payment.
3. **Expect:** redirect chain → `/api/desktop/checkout/success` → `talysman://billing/success`
   → app foregrounds; within a refresh the plan badge shows **Pro** and the Account page
   shows "billed monthly · Renews on {date}".
4. `stripe listen` (dev) shows `checkout.session.completed` + `customer.subscription.created`
   delivered with 200s; `subscriptions` row exists with `status=active`.
5. Cancel mid-checkout → `talysman://billing/cancel` → app refocuses, still free, no error.

### 5.2 Subscription detail [D, P]

- `GET /api/desktop/subscription` with a valid bearer token returns the JSON snapshot:
  ```sh
  curl -H "Authorization: Bearer $TOKEN" $BASE/api/desktop/subscription
  ```
  (Grab a token in dev by logging it from `getAccessToken`, or from the web session.)
- No token / bad token → 401. Signed-in-but-never-subscribed → `{"hasSubscription":false,"plan":"free"}`.
- Yearly subscriber shows `price: "yearly"` (validates the price-ID mapping — a wrong
  `STRIPE_PRICE_YEARLY` env shows up here as "monthly").

### 5.3 Cancel at period end [D, P]

1. Account → "Cancel at period end" → **Expect a two-click confirm** ("Confirm
   cancellation" / "Keep subscription").
2. Confirm → **immediately** shows "Cancels on {date}" + "Resume subscription" button
   (this proves the synchronous `syncSubscription` path — it must NOT wait for the webhook).
3. Stripe dashboard: subscription has `cancel_at_period_end: true`.
4. The webhook `customer.subscription.updated` arrives afterwards → still one row, no
   duplicate; **no cancellation email is sent** (that email is reserved for
   `customer.subscription.deleted`, i.e. actual end-of-term).
5. Entitlement stays **Pro/active** for the whole scheduled period.

### 5.4 Resume [D, P]

"Resume subscription" → flips back to "Renews on {date}"; Stripe shows
`cancel_at_period_end: false`. Double-click protection: mashing the button must not error
(second Stripe update is a no-op; `busy` guards the UI).

### 5.5 Billing portal [D, P]

"Manage billing" opens the Stripe portal in the browser for a subscriber. A signed-in
user with **no** Stripe customer gets the "No billing account yet" message, not a 500.

### 5.6 Payment failure / past due [D]

Easiest in dev: in the Stripe sandbox dashboard, update the subscription's payment method
to test card `4000 0000 0000 0341` (attaches but fails charges) and advance/invoice it, or
use `stripe trigger invoice.payment_failed`.
**Expect:** webhook 200, `subscriptions.status = past_due`, desktop shows the
"Payment issue" badge + the "use Manage billing" hint, and the payment-failed Resend email
fires (dev: check Resend logs/test mode).

### 5.7 Full cancellation at term end [D — clock simulation only]

Use Stripe test clocks (sandbox) to advance past `current_period_end` with
`cancel_at_period_end: true` → `customer.subscription.deleted` fires → row becomes
`canceled`, entitlement drops to free after the 5-min cache expires, plan limits
re-constrain (blocklist caps, schedule disabled), and the cancellation email sends **once**
(the `stripe_events` dedup table is what prevents doubles on Stripe retries — check it has
one row per event id).

### 5.8 Entitlement plumbing [D, P]

- After any billing change, `GET /api/desktop/entitlement` reflects it within the 5-minute
  `cacheUntil` window.
- **Offline grace:** subscribe, then kill the network (or stop the web server in dev) and
  restart the desktop app → plan stays Pro from `entitlement-cache.json` (source `offline`);
  the subscription detail card may be stale/absent — that's by design (display-only, no cache).
- Prod only: verify the desktop is NOT running with a `dev-entitlement.json` override
  (source shown must be `server`/`cache`, never `dev-override`).

---

## 6. Security / secrets checks [D + P, and on every release build]

- [ ] `grep -r "sk_live\|sk_test\|STRIPE_SECRET\|SUPABASE.*SECRET\|service_role" apps/desktop/out/`
      → only supabase-js doc-comment mentions of "service_role" are acceptable; **no actual
      key material**. The desktop bundle may contain the Supabase **anon** key — that's public
      by design.
- [ ] Renderer surface: in the app's devtools, `window.api` exposes only the typed methods;
      `window.api.authStatus()` returns at most `{signedIn, email, passwordRecovery}` — no
      tokens anywhere in the renderer.
- [ ] All six `/api/desktop/*` routes return **401 without a bearer token** (curl each).
- [ ] Webhook rejects an unsigned POST: `curl -X POST $BASE/api/stripe/webhook -d '{}'` → 400.
- [ ] Cancel/resume with user A's token never touches user B's subscription (the lookup is
      keyed by the token's user id — spot-check with two accounts).
- [ ] RLS: with an anon-key client + user JWT, `select * from subscriptions` returns only
      your own rows; `update subscriptions …` fails.

---

## 7. Cross-cutting regression checks

- Web auth pages (`/login`, `/signup`, `/forgot-password`, `/reset-password`) and web
  checkout (`/api/stripe/*`, cookie-based) still work — the desktop work added routes but
  must not have changed web behavior.
- Google OAuth from the **website** still lands on the web callback, not the deep link.
- Plan limit enforcement still reacts to auth events: sign out while Pro-only features
  (schedule, >5 domains) are configured → they get constrained; sign back in → restored.
- Deep-link registration survives an app reinstall (Windows: protocol handler in registry;
  Linux: .desktop file; macOS: Info.plist scheme).

## Known limitations (expected behavior, don't file as bugs)

- Email links (confirm + reset) only complete on the machine/app that requested them
  (PKCE verifier in encrypted local storage). Cross-device → use the website.
- Subscription detail is display-only and not cached: offline it goes stale or empty while
  entitlement (the thing that gates features) keeps working from its own cache.
- After checkout, the plan badge can lag a few seconds (webhook + refresh); the
  `billing/success` deep link forces a refresh but Stripe's webhook timing varies.
