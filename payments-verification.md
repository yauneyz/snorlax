# Payments Verification & Go-Live Guide

How to **thoroughly test the Stripe payment system**, then take it from the current
**test/sandbox** setup to a **verified live-mode** account that's ready for the first real
signup from an internet stranger.

Companion to [`payments-arch.md`](./payments-arch.md) (architecture). This doc is both the
**test plan** — what to run, in what order, and what "correct" looks like — and the
**go-live config checklist** (it absorbed the former `payments-todo.md`).

> **Golden rule (Stripe best practice):** every dollar of real money flows through the
> **live** account with **live** keys; every rehearsal flows through a **test/sandbox**
> account with **test** keys. The two never mix. You verify *behavior* in test mode, then
> re-run the same checklist against live mode with a real card before opening the doors.

---

## 0. Current state (snapshot — verified via Stripe MCP, 2026-07-29)

| Thing | State | Notes |
|---|---|---|
| Connected Stripe account | **`acct_1TpxytEtUnIVGugJ` — "Talysman sandbox"** | Test mode. The real Talysman account is separate and **pending verification**. |
| Monthly price | ✅ `price_1Tq6JTEtUnIVGugJ79g05j6r` | "Talysman Pro", **$10.00/mo** — matches the pricing page. |
| Annual price | ✅ `price_1Tq6L0EtUnIVGugJfj3PhSR0` | "Talysman Pro Annual", **$100.00/yr** — matches the pricing page. |
| Stray price | ⚠️ `price_1Tq6kyEtUnIVGugJ918SDdUa` "myproduct" $15/mo | Junk from a `stripe trigger`. Harmless; archive it to avoid confusion. |
| Webhook endpoint | ✅ `https://talysman.app/api/stripe/webhook` (test) | Subscribed to exactly the 8 events the handler needs (see §1.3). |
| Billing portal config | ❌ **none exists** | `billingPortal.sessions.create` will **throw** until the test-mode portal is configured once in the Dashboard. See §3.4 / §4.C. |
| Tax behavior | ⚠️ monthly `unspecified`, annual `exclusive` | Inconsistent. Decide on one before live (see §5.4). |
| `talysman.app` deploy | ❌ not deployed yet | The registered webhook URL 404s until the Vercel prod deploy exists. |

**What this means for sequencing:** the sandbox is *almost* ready to exercise end-to-end
locally today (Phase A). The registered webhook points at an undeployed domain, so
sandbox testing happens either (1) locally via the Stripe CLI listener, or (2) against a
deployed Vercel **preview** URL with a preview-scoped webhook. Live mode (Phase B) is
blocked on account verification + the prod deploy.

---

## 1. The moving parts (payments only)

Most "bugs" during verification are one of these misconfigured. Auth mechanics live in
`payments-arch.md` §2; here we care about the money path.

### 1.1 Server (source of truth)

| Part | File | Role |
|---|---|---|
| Billing brain | `packages/billing-server/src/index.ts` | `createCheckoutSession`, `createPortalSession`, `syncSubscription`, `getUserEntitlement`, `getSubscriptionDetail`, `setCancelAtPeriodEnd`. Stripe SDK pinned to API `2026-05-27.dahlia`. |
| Stripe client | `apps/web/src/lib/stripe/client.ts` | Lazily builds the SDK from `config.stripe.secretKey`. |
| Web routes (cookie auth) | `apps/web/src/app/api/stripe/{checkout,checkout/success,portal,webhook}/route.ts` | Browser-driven checkout/portal + the authoritative webhook. |
| Desktop routes (bearer auth) | `apps/web/src/app/api/desktop/{checkout,checkout/success,checkout/cancel,portal,subscription,subscription/cancel,subscription/resume,entitlement}/route.ts` | Same logic, `requireBearerUser`, redirects to `talysman://` deep links. |
| Config gate | `apps/web/src/lib/config.ts` | Zod-validates `STRIPE_*` at module load. Fails fast on a missing/blank key. `STRIPE_MODE` ∈ `test`\|`live`. |
| Product contract | `packages/product/src/index.ts` | `CHECKOUT_PRICES = ['monthly','yearly']`, entitlement + free-tier limits (≤5 domains, no apps, no schedule). |

### 1.2 Data

`apps/web/supabase/migrations/` — `profiles` (holds `stripe_customer_id`, unique),
`subscriptions` (PK = Stripe sub id, **service-role writes only** under RLS),
`active_entitlements` view (subscriptions ∪ comp grants — the single read for
entitlement), `stripe_events` (webhook dedup ledger, migration `0003`).

### 1.3 Webhook — the authoritative writer

`apps/web/src/app/api/stripe/webhook/route.ts` (Node runtime; raw body + signature verify
against `STRIPE_WEBHOOK_SECRET`). Handles and **must stay subscribed to exactly**:

```
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
customer.subscription.paused
customer.subscription.resumed
invoice.payment_failed        → Resend "PaymentFailed" email
charge.refunded               → Resend "RefundIssued" email
customer.subscription.deleted → Resend "SubscriptionCancelled" email
```

Idempotent via `stripe_events` (a retried event returns `{duplicate:true}` and re-sends no
email). Any handler throw → 500 → Stripe retries. The success-redirect sync
(`/checkout/success`) is a best-effort fast path; **the webhook is the source of truth.**

### 1.4 External services

- **Stripe** — checkout, portal, subscriptions, webhooks. Test = "Talysman sandbox"; live =
  the real Talysman account (pending verification).
- **Resend** — transactional emails from the webhook. Server-only.
- **Supabase** — users, `profiles`/`subscriptions`, RLS.

---

## 2. Pre-flight: credentials, config & automated checks

### 2.1 Credentials & config (the source of everything)

`.credentials` at the monorepo root (gitignored) is the single source of truth for every
secret; `pnpm sync:env` generates the env files from it — **never hand-edit `.env.local`,
never commit secrets.**

- [ ] Copy `.credentials.example` → `.credentials`; fill `[supabase.dev]` / `[supabase.prod]`
      (url, publishable_key, secret_key, project_ref).
- [ ] Fill `[stripe]`: `price_id_{monthly,yearly}_test` **and** `_live`, test **and** live
      keys, and both webhook secrets. `mode` picks which key + price set gets exported.
- [ ] Fill `[resend]` (`api_key`, `from`) — the webhook's transactional emails need it.
- [ ] `pnpm sync:env` writes `apps/web/.env.local` (server secrets) and root `.env.local`
      (desktop-safe **public** vars only). `--mode=prod` selects cloud/live values.
- [ ] Confirm `API_BASE_URL` in the generated root `.env.local` points at the Next.js
      origin (auto-derived from `[app].url_dev` / `url_prod`) — this is the web origin the
      desktop calls for `/api/desktop/*`.

### 2.2 Automated checks (run before any manual testing)

Green here rules out the whole class of "the code is wrong" before you spend time clicking.

```sh
# repo root
pnpm typecheck
pnpm test                        # root vitest (incl. productLimits, entitlement)

# web
cd apps/web
pnpm typecheck && pnpm lint
pnpm test                        # unit: stripe-sync, subscription-detail
pnpm test:webhook                # integration: signed webhook → DB (stripe-webhook-cli.test.ts)
```

The billing unit/integration suites (`tests/unit/stripe-sync.test.ts`,
`tests/integration/stripe-webhook-cli.test.ts`, `tests/unit/subscription-detail.test.ts`)
assert the sync + dedup + detail logic without touching the network. If these are red,
**stop and fix** before touching Stripe.

---

## 3. Phase A — Test-mode verification (sandbox)

Goal: prove every payment path works end-to-end against the **"Talysman sandbox"** account
with **test cards**. Do this fully before even thinking about live mode.

### 3.0 Sanity-check what's connected

```sh
# Confirm the secret key resolves to the sandbox account and the right mode.
cd apps/web
node -e "require('dotenv').config({path:'.env.local'}); \
  console.log('mode=', process.env.STRIPE_MODE, \
  'key=', (process.env.STRIPE_SECRET_KEY||'').slice(0,12), \
  'monthly=', process.env.STRIPE_PRICE_MONTHLY, \
  'yearly=', process.env.STRIPE_PRICE_YEARLY)"
```

Expect `mode=test`, `key=sk_test_...`, and the two price IDs from §0. **Account-mismatch is
the #1 obscure checkout failure:** the price IDs must belong to the same account as the
secret key. (They do today — both are on the sandbox account.)

### 3.1 Local stack + Stripe CLI listener

```sh
pnpm dev          # Supabase + web + Stripe forwarding + desktop; injects the whsec automatically
```

- Web: http://localhost:3000 · Supabase Studio: http://localhost:54323 · local mail
  (Inbucket/Mailpit): http://localhost:54324
- The `pnpm dev` script runs `stripe listen --forward-to localhost:3000/api/stripe/webhook`
  and passes the ephemeral signing secret straight to Next. That secret is **not** the
  dashboard webhook's secret — it's per-listener, which is exactly what you want locally.

Alternative fully-scripted event sweep (no browser):

```sh
cd apps/web && pnpm stripe:test   # listens + triggers all 8 events; watch each 200 in the log
```

### 3.2 Checkout — web (cookie auth)

1. Sign in on the website → visit `/pricing` → **Monthly**.
2. On Stripe Checkout use test card **`4242 4242 4242 4242`**, any future expiry, any CVC,
   any ZIP. (`/test-cards` skill lists more scenarios.)
3. **Expect:** redirect to `/app?checkout=success`; plan reads **Pro** immediately (the
   success route's fast-path `syncSubscription` ran before the webhook landed).
4. **DB check** (Studio): `subscriptions` has one row, `status=active`, `price_id` = monthly,
   `current_period_end` ~1 month out; `profiles.stripe_customer_id` populated.
5. **Webhook check:** the CLI log shows `checkout.session.completed` +
   `customer.subscription.created` → both 200. A **second** delivery of the same event id
   returns `{duplicate:true}` — confirms the `stripe_events` ledger.
6. Repeat with **Annual** → `price_id` = yearly, `current_period_end` ~1 year out.
7. **Promo codes:** checkout has `allow_promotion_codes: true`. Create a test coupon +
   promo code in the sandbox and confirm it applies.

### 3.3 Checkout — desktop (bearer auth + deep links)

1. In the desktop app: sign in → Account/Plans → **Upgrade – Monthly**.
2. It opens the system browser to Stripe Checkout (via `POST /api/desktop/checkout`). Pay
   with the test card.
3. **Expect:** browser bounces through `/api/desktop/checkout/success` →
   `talysman://billing/success`; the OS offers to reopen Talysman; the app foregrounds and
   the plan flips to **Pro** with no manual refresh (`entitlementChanged` event).
4. **Dev gotcha:** non-prod desktop builds short-circuit `getEntitlement()` with
   `dev-entitlement.json` (default **pro**, `source: dev-override`), which *masks* the real
   server path. To verify the true server flow, either set the dev switch to **free** and
   watch the **subscription detail** card (it always hits the server), or test with a
   production-env desktop build pointed at your dev/preview backend.
5. Cancel path: start checkout → hit browser Back/Cancel → lands on
   `talysman://billing/cancel`; plan unchanged.

### 3.4 Billing portal — ⚠️ configure it first

`createPortalSession` calls `stripe.billingPortal.sessions.create`. **There is no portal
configuration in the sandbox yet (§0), so this will throw** ("...default configuration has
not been created"). Fix once:

- Dashboard (test mode) → **Settings → Billing → Customer portal** → enable it and **Save**.
  That creates the default test config. Allow: update payment method, cancel, switch
  plans (optional), view invoices.
- Optionally capture a specific configuration id into `STRIPE_PORTAL_CONFIG_ID`; blank =
  use the account default (fine).

Then verify:

1. `/account` (web) → **Manage billing** → opens the Stripe portal → returns to `/account`.
2. Desktop → **Manage billing** → same, via `POST /api/desktop/portal`.
3. A user with **no** `stripe_customer_id` (never subscribed) → route returns 400
   `NoStripeCustomerError`, UI shows a friendly message (not a 500).

### 3.5 Subscription lifecycle (cancel / resume / renew)

Drive these from the desktop subscription card, the web portal, **and** the Stripe
Dashboard — all three must converge (webhook reconciles).

1. **Cancel at period end:** `POST /api/desktop/subscription/cancel` (or portal). Expect
   `cancel_at_period_end=true`, `status=active`, plan **still Pro** until period end. No
   cancellation email yet (email only fires on true `deleted`).
2. **Resume:** `POST /api/desktop/subscription/resume` → `cancel_at_period_end=false`.
3. **Immediate cancel:** Dashboard → cancel now → `customer.subscription.deleted` →
   `active_entitlements` drops the row → plan flips to **Free**; **SubscriptionCancelled**
   email appears in Inbucket.
4. **Renewal:** Dashboard → the subscription's next invoice → "Advance clock" (test clocks)
   or just trust the `updated` event; `current_period_end` moves forward.
5. **Pause/resume:** trigger `customer.subscription.paused` / `resumed`; confirm the
   `subscriptions.status` mirrors and entitlement follows.

### 3.6 Failure & refund paths

1. **Payment failed:** attach a decline-on-renewal test card
   (**`4000 0000 0000 0341`**) or `stripe trigger invoice.payment_failed`. Expect a
   **PaymentFailed** email with the hosted invoice URL; entitlement behavior matches the
   subscription's resulting status (`past_due` still counts as current for display).
2. **Hard decline at checkout:** card **`4000 0000 0000 0002`** → checkout shows the
   decline; no subscription row created.
3. **3DS / authentication:** card **`4000 0025 0000 3155`** → completes the auth step, then
   subscription is created.
4. **Refund:** Dashboard → refund the latest charge (or `stripe trigger charge.refunded`) →
   **RefundIssued** email; verify the amount/currency in the email match.

### 3.7 Idempotency & resilience

- Re-deliver any processed event from the Dashboard ("Resend") → handler returns
  `{duplicate:true}`, **no** second email, DB unchanged.
- Simulate a handler failure (e.g. temporarily point `SUPABASE_SECRET_KEY` at a bad value)
  → webhook returns 500 → Stripe retries → succeeds once fixed. Confirms retry safety.
- **Signature check:** `curl -X POST localhost:3000/api/stripe/webhook -d '{}'` with no/bad
  `stripe-signature` → **400**, nothing written.

### 3.8 Entitlement propagation

- Freshly-subscribed desktop client: `GET /api/desktop/entitlement` →
  `{active:true, plan:'pro', source:'server', currentPeriodEnd, fetchedAt, cacheUntil}`.
- Kill the web server → next refresh serves the disk cache with `source:'offline'`; restart
  → `source:'server'` again.
- Free user (no sub, no comp) → `plan:'free'`, and free limits enforce on the desktop
  (≤5 domains, no apps, no scheduling).

### 3.9 (Optional) Deployed-preview sandbox pass

To exercise the *real* webhook delivery path (not the CLI listener) before live:

- Deploy a Vercel **preview** with `pnpm sync:env:preview` (still test-mode Stripe).
- Register a **temporary test-mode webhook** at
  `https://<preview-url>/api/stripe/webhook` with the 8 events; put its signing secret in
  the preview env; re-run §3.2–§3.7 against the preview URL. Delete that endpoint after.
- This proves signature verification works with a *dashboard* secret (not just the CLI
  secret) — the one difference between local and production.

**Exit criteria for Phase A:** §3.2–§3.8 all pass; automated suites green; the stray
`myproduct` price archived. Only now proceed to live.

---

## 4. Phase B — Go live (live mode)

Live mode is a **repeat of Phase A against the real account with a real card**, plus the
one-time account/config work below. Nothing about the code changes — only env values and
`STRIPE_MODE=live`.

### 4.A Activate & verify the real Stripe account (blocking)

- In the **real Talysman** Stripe account (not the sandbox), complete **Activate your
  account**: business details, bank account for payouts, identity verification, statement
  descriptor, support email/phone. Until this is done, Stripe won't process live charges.
- Set the **public business details** (name, address, support contact) — these show on
  receipts and the hosted invoice/portal that your first customer will see.
- Confirm the account can accept live payments (Dashboard shows no outstanding
  verification tasks).

### 4.B Create live products & prices

- In **live mode**, create **Talysman Pro** ($10/mo) and **Talysman Pro Annual** ($100/yr) —
  mirror the sandbox. **Live price IDs are different** from test; capture them.
- Set **tax behavior consistently** on both (see §5.4). Don't leave one `unspecified` and
  one `exclusive`.
- Archive/ignore any stray products.

### 4.C Configure the live billing portal

- Dashboard (live) → **Settings → Billing → Customer portal** → enable + Save (same as
  §3.4, but live). Without this, live "Manage billing" throws.

### 4.D Register the live webhook

- The `https://talysman.app/api/stripe/webhook` endpoint currently registered is **test
  mode**. Register a **live-mode** endpoint at the same URL, subscribed to the exact 8
  events in §1.3. Capture its **live signing secret** (`whsec_...`).

### 4.E Fill live env & deploy

Update `.credentials` `[stripe]`: `mode = "live"`, `secret_key_live`, `publishable_key_live`,
`webhook_secret_live` (the **live** `price_id_monthly_live` / `price_id_yearly_live` are
already filled). `sync:env` fails fast if any live value is missing. Then:

```sh
pnpm sync:env:prod       # pushes production env to Vercel (never commit .env.local)
```

Verify in Vercel (production) that these resolve to live values:
`STRIPE_MODE=live`, `STRIPE_SECRET_KEY=sk_live_...`,
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...`, `STRIPE_WEBHOOK_SECRET` (live),
`STRIPE_PRICE_MONTHLY`/`STRIPE_PRICE_YEARLY` (live), plus `NEXT_PUBLIC_APP_URL=https://talysman.app`,
Supabase prod keys, `RESEND_API_KEY`. Deploy `talysman.app` to production.

> **Account-mismatch guard (repeat):** live price IDs must belong to the same account as
> `sk_live_...`. Copy them from the live Dashboard, never from test.

### 4.F Desktop production build

- Production desktop config: `API_BASE_URL=https://talysman.app`, prod
  `VITE_SUPABASE_URL`/`ANON_KEY`, `pk_live_...`. Confirm **no** `sk_*` / `whsec_` ships in
  the bundle (`__APP_CONFIG__` carries only public keys). Worth a CI grep.

### 4.G Desktop packaging & billing deep links

- Confirm `electron-builder.yml` registers the `talysman://` protocol on **every** target OS
  so `billing/success` / `billing/cancel` (and `auth/callback`) resolve in installed —
  not just `pnpm dev` — builds. (Registration code is in `src/main/index.ts` / `window.ts`;
  the manifest side is build config.)
- Test the billing deep-link round-trips from a **packaged** build: `billing/success` and
  `billing/cancel`, exercising both cold-start (argv) and running-instance paths.

### 4.H Prod Supabase & data

- Confirm migrations `0001`–`0005` are applied to the **prod** Supabase project (esp.
  `subscriptions`, the `stripe_events` ledger, and the `active_entitlements` view).
- Confirm RLS is on: `subscriptions` is **owner-read, service-role-write-only** — only the
  webhook writes it. A client must never be able to mint entitlement.

### 4.I Backend hardening (before opening to the public)

- **Rate limiting** on `/api/desktop/*` and `/api/stripe/{checkout,portal}`. (The webhook is
  signature-gated, but the auth'd checkout/portal routes are not.)
- On a **401** from checkout/portal, refresh the access token once and retry (the
  entitlement path already degrades to signed-out on 401).
- Confirm **Sentry** coverage on all desktop + stripe routes (entitlement already reports).

---

## 5. Phase C — First real signup (live smoke test)

Do this yourself, with a **real card**, before announcing. Refund yourself after.

1. **Real checkout:** on production `talysman.app`, sign up as a fresh user → `/pricing` →
   **Monthly** → pay with a **real** card. Expect Pro immediately; `subscriptions` row in
   the **prod** Supabase project; `livemode:true` on the Stripe objects.
2. **Live webhook delivery:** Dashboard (live) → the endpoint → recent deliveries all 200.
   This is the one thing the CLI listener could not prove.
3. **Receipt/invoice:** confirm the customer-facing receipt shows the correct business name
   and descriptor.
4. **Portal:** Manage billing opens the live portal, cancel/resume works.
5. **Desktop end-to-end:** on a **packaged** production build, sign in → upgrade → pay →
   `talysman://billing/success` deep link foregrounds the app as Pro. Test cold-start
   (app quit) and running-instance deep-link paths.
6. **Refund yourself:** Dashboard → refund → **RefundIssued** email arrives → entitlement
   drops appropriately. Confirms the full money-out path too.
7. **Annual:** repeat the checkout once on the annual price.

**Ready-for-strangers criteria:** steps 1–6 pass on live with a real card; live webhook
deliveries are 200; the portal + emails work; the desktop deep-link round-trip works from a
packaged build. Then open the doors.

### 5.4 Decisions to settle before opening the doors

- **Sales tax:** decide whether to enable **Stripe Tax** (auto-collect) and set a
  consistent `tax_behavior` on both prices. Today monthly is `unspecified` and annual is
  `exclusive` — pick one. If you enable Stripe Tax, checkout needs `automatic_tax` (not
  currently set in `createCheckoutSession`) — a code change, so decide early.
- **Trials:** none configured. If you want one, it's `subscription_data.trial_period_days`.
- **Rate limiting** on `/api/desktop/*` and `/api/stripe/*` (abuse protection) — see §4.I;
  nice-to-have before a public launch.
- **Refund/cancellation policy** text on the pricing/terms pages, since real strangers will
  read it.

---

## 6. Quick reference — test cards

| Scenario | Card |
|---|---|
| Success | `4242 4242 4242 4242` |
| Generic decline | `4000 0000 0000 0002` |
| Insufficient funds (renewal fail) | `4000 0000 0000 0341` |
| 3D Secure required | `4000 0025 0000 3155` |
| Charge succeeds, dispute later | `4000 0000 0000 0259` |

Any future expiry, any 3-digit CVC, any postal code. Full list: the `/test-cards` skill or
stripe.com/docs/testing. **Test cards only work on test keys** — a test card on a live key
is declined, and a real card on a test key does nothing.

---

## 7. One-glance go-live checklist

**Test mode (Phase A)**
- [ ] Automated suites green (§2)
- [ ] Web + desktop checkout → Pro; DB row correct (§3.2–3.3)
- [ ] Portal configured + works; no-customer case 400s (§3.4)
- [ ] Cancel / resume / immediate-cancel / renew (§3.5)
- [ ] Payment-failed, decline, 3DS, refund emails (§3.6)
- [ ] Idempotency + bad-signature 400 (§3.7)
- [ ] Entitlement server/offline/free (§3.8)
- [ ] Stray `myproduct` price archived

**Live mode (Phase B)**
- [ ] Real Stripe account activated & verified (§4.A)
- [ ] Live products/prices created; tax behavior consistent (§4.B, §5.4)
- [ ] Live billing portal configured (§4.C)
- [ ] Live webhook endpoint + secret at `talysman.app/api/stripe/webhook` (§4.D)
- [ ] `STRIPE_MODE=live` + all live env in Vercel; prod deployed (§4.E)
- [ ] Desktop prod build: live pk only, no secrets (§4.F)
- [ ] `talysman://` protocol registered; billing deep links round-trip from a packaged build (§4.G)
- [ ] Migrations `0001`–`0005` applied to prod Supabase; RLS service-role-write-only (§4.H)
- [ ] Rate limiting + 401 retry + Sentry on payment routes (§4.I)

**First stranger (Phase C)**
- [ ] Real-card checkout → Pro, `livemode:true` (§5.1)
- [ ] Live webhook deliveries 200 (§5.2)
- [ ] Portal + emails + desktop deep-link round-trip (§5.4–5.5)
- [ ] Self-refund verified, then doors open (§5.6)
</content>
</invoke>
