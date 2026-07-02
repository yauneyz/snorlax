# Payments & Auth — Go-Live To-Do

The desktop↔backend wiring is **done in code** (see `payments-arch.md`). What remains is
configuration and go-live hardening that can't be done from the codebase alone. Grouped by
who/where, roughly in the order you'd do them.

---

## 1. Credentials & config (do first)

- [ ] Copy `.credentials.example` → `.credentials` at the monorepo root (gitignored) and fill
      in real values. This is the single source of truth.
- [ ] Fill `[supabase.dev]` / `[supabase.prod]` (url, publishable_key, secret_key, project_ref).
- [ ] Fill `[stripe]`: `price_id_monthly`, `price_id_yearly`, test + live keys, webhook secrets.
- [ ] Run `pnpm sync:env` → writes `apps/web/.env.local` (server secrets) and root `.env.local`
      (desktop-safe public vars). Never edit those by hand; never commit secrets.
- [ ] Verify `API_BASE_URL` in the generated root `.env.local` points at the Next.js origin
      (auto-derived from `[app].url_dev` / `url_prod`).

## 2. Supabase project setup

- [ ] Add `talysman://auth/callback` to the allowed redirect URLs — **required** for desktop
      OAuth to complete:
  - Local: `apps/web/supabase/config.toml` → `auth.additional_redirect_urls`.
  - Cloud: Dashboard → Authentication → URL Configuration → Redirect URLs.
- [ ] Enable the **Google** auth provider (Dashboard → Authentication → Providers); set the
      Google OAuth client ID/secret. (Email/password works without this.)
- [ ] Confirm RLS is enabled on `profiles` / `subscriptions` (already in migrations) and the
      migrations are applied to the cloud project.

## 3. Stripe go-live

- [ ] Create live products + prices; set live `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY`.
- [ ] Register the **live** webhook endpoint (`POST /api/stripe/webhook`) and set the live
      `STRIPE_WEBHOOK_SECRET`.
- [ ] Set `[stripe].mode = "live"` (→ `STRIPE_MODE=live`) when deploying production.
- [ ] Smoke-test webhook idempotency under retries (covered by the `stripe_events` ledger —
      just confirm).

## 4. Deploy / environment

- [ ] Set `[app].url_prod` to the deployed web origin so the desktop's `API_BASE_URL` resolves
      to production.
- [ ] On Vercel (or host), push env via `pnpm --filter @talysman/web sync:env:prod`
      (`--production`) instead of committing `.env.local`.
- [ ] Confirm only publishable/anon keys ship in the desktop bundle (`__APP_CONFIG__` carries
      `API_BASE_URL` + `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`); no `*_SECRET_KEY` /
      `STRIPE_WEBHOOK_SECRET`. Worth a CI check.

## 5. Desktop packaging

- [ ] Confirm `electron-builder.yml` registers the `talysman://` protocol on every target OS
      so deep links resolve in installed (non-`pnpm dev`) builds.
- [ ] Test the deep-link round-trips from a packaged build: `auth/callback`, `billing/success`,
      `billing/cancel` (cold-start argv + running-instance paths).

## 6. Backend hardening (nice-to-have)

- [ ] Add rate limiting to `/api/desktop/*`.
- [ ] On `401` from checkout/portal, refresh the access token once and retry (entitlement
      already degrades to signed-out on 401).
- [ ] Confirm Sentry coverage on all desktop routes (entitlement already reports).

---

## Manual verification (end-to-end)

1. **Email/password:** sign in via the Account form → restart the app → still signed in.
2. **Google:** Sign in with Google → browser consent → `talysman://auth/callback` → signed in.
3. **Checkout:** Upgrade (Stripe test card) → `billing/success` deep link → plan flips to Pro
      without a manual refresh; **Manage billing** opens the Stripe portal.
4. **Offline:** stop the web server → entitlement stays last-known (`source: 'offline'`);
      restart → next refresh shows `source: 'server'`.
5. **Loading:** on launch the plan badge shows **Checking…**, then resolves (no Free→Pro flash).

## Decided this iteration

- Transport: **Next.js `/api/desktop/*` only** (Supabase Edge Function path removed).
- Sign-in: **both** Google browser-OAuth (PKCE) and in-app email/password.
- Offline: keep last-known entitlement **indefinitely while signed in** (the USB-key disable
  gate, not entitlement, is the anti-bypass control).
- First-load UI: **neutral "Checking…"** until the first entitlement fetch resolves.
