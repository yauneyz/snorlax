# Google OAuth Verification Guide

How to confirm Google account **creation and sign-in** work end-to-end — on the website and in a
packaged desktop build — in **dev** and **prod**. Run this after following `oauth-setup.md`.

The key thing to internalise: with Supabase, "Sign up with Google" and "Continue with Google"
are the **same call**. A first-time Google user gets an `auth.users` row (and a `profiles` row
via the `handle_new_user` trigger) created automatically. There is no separate signup code path
to verify — only first-use vs. returning-use behaviour.

---

## 0. The moving parts

| Part | Where | What it does |
|---|---|---|
| Web button | `apps/web/src/components/auth/OAuthButtons.tsx` | `signInWithOAuth({ provider: 'google', redirectTo: /api/auth/callback })`. Gated on `config.google.authEnabled`. |
| Web callback | `apps/web/src/app/api/auth/callback/route.ts` | Exchanges the code, then routes by `flow`/`next`. |
| Desktop button | `apps/desktop/src/renderer/pages/Account.tsx` (signup + signin views) | Gated on `__APP_CONFIG__.GOOGLE_AUTH_ENABLED`. Calls the `signInGoogle` IPC channel. |
| Desktop OAuth start | `apps/desktop/src/main/auth/supabase.ts` → `signInWithGoogle()` | PKCE, `skipBrowserRedirect`, opens the **system browser**, `redirectTo: talysman://auth/callback`. |
| Desktop deep-link return | `apps/desktop/src/main/window.ts` (`handleDeepLink`) → `completeOAuth()` | Exchanges the code for a session in the **main** process. Renderer never sees tokens. |
| Feature flag | `.credentials` `[google_auth]` → `GOOGLE_AUTH_ENABLED` (desktop, build-time) / `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` (web) | Whether the Google buttons render at all. |
| Provider config | `apps/web/supabase/config.toml` base (local) + `[remotes.prod]` (pushed) | Enables the Google provider and the redirect allow-list on each Supabase project. |

Most "OAuth is broken" reports are one of these misconfigured — check them before debugging code.

---

## 1. Pre-flight (config, not clicking)

Run these before any manual clicking. They catch the common failures cheaply.

**Flag matches the mode you're testing.** After `pnpm sync:env` (dev) or `pnpm sync:env:prod`:

```bash
# dev: written to the repo root .env.local (desktop) and apps/web/.env* (web)
grep GOOGLE_AUTH_ENABLED .env.local
grep NEXT_PUBLIC_GOOGLE_AUTH_ENABLED apps/web/.env*
```

Both should be `true` for the environment under test. If a desktop button is missing, this flag
was `false` **at build time** — rebuilding is the only fix.

**Prod provider + redirect allow-list is actually pushed:**

```bash
cd apps/web && supabase link --project-ref lkanoehzgogtrxzycutl
# Re-push is idempotent; use it to confirm the merged config is what you expect.
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=$(jq -r .web.client_id ../oauth/google-web-client.json) \
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET=$(jq -r .web.client_secret ../oauth/google-web-client.json) \
supabase config push --project-ref lkanoehzgogtrxzycutl
```

Confirm the pushed `[remotes.prod]` block has:
- `site_url = https://www.talysman.app`
- `additional_redirect_urls` includes `talysman://auth/callback`, `talysman://auth/reset-callback`, and the web `/api/auth/callback` for both apex and `www`
- `[remotes.prod.auth.email] enable_confirmations = true`
- `[remotes.prod.auth.external.google] enabled = true`

**Google Console** (can't be checked from the CLI — do this by eye):
- Authorized redirect URIs on the client include
  `https://lkanoehzgogtrxzycutl.supabase.co/auth/v1/callback`.
- Consent screen is **Published** (not Testing), or your test account is on the test-user list.

---

## 2. Dev — website

```bash
pnpm dev   # Supabase + web + desktop; Studio at http://localhost:54323
```

1. Open http://localhost:3000/signup. The **"Sign up with Google"** button is visible.
2. Click it → system Google chooser → pick an account **never used with Talysman**.
3. You land back in the app signed in. In Studio → Authentication, confirm **one** new
   `auth.users` row, and in the SQL editor confirm one matching `profiles` row:
   ```sql
   select u.email, p.full_name, p.avatar_url
   from auth.users u join public.profiles p on p.id = u.id
   order by u.created_at desc limit 1;
   ```
   `full_name` and `avatar_url` should be populated from the Google profile.
4. **Returning use:** sign out, click "Continue with Google", pick the same account → no new
   row; you're reused.
5. **Identity linking:** create an email/password account, confirm it, sign out, then use Google
   with the **same verified email**. Supabase links the identity — still one `profiles` row, no
   duplicate.
6. **Cancel path:** start the flow, close the Google chooser. The login/signup surface shows a
   recoverable error, not a stuck spinner.

---

## 3. Dev — desktop

The dev desktop app launches as part of `pnpm dev`. If the button is missing, re-check the
pre-flight flag and restart (the flag is injected at build/serve time).

1. Account page → **Sign up** view → **"Sign up with Google"**.
2. The **system browser** opens (not an in-app window). Complete the Google chooser.
3. The browser hands off to `talysman://auth/callback`; the desktop app catches the deep link
   and flips to signed-in. Confirm the account email shows in the UI.
4. **Cold-start deep link:** fully quit the desktop app, then re-trigger the callback URL (or
   re-run the flow and quit mid-flight). On relaunch the deep link still completes — the PKCE
   verifier is persisted in the encrypted session store.
5. **Returning use** and **identity linking:** same as web steps 4–5.

---

## 4. Prod

Only meaningful **after** step 9 of `oauth-setup.md` (`enabled_prod = true`, web redeployed,
**new desktop release shipped**). Existing desktop installs will not show the button until they
auto-update, because the flag is compiled in.

1. **Web:** https://www.talysman.app/signup → "Sign up with Google" is present → sign up with a
   fresh Google account → confirm the new `auth.users` + `profiles` rows in the **prod** project
   (`lkanoehzgogtrxzycutl`).
2. **Desktop:** install/update to the release built with `enabled_prod = true`. Repeat §3
   against prod. Test the callback both while the app is **running** and from a **cold start**.
3. Repeat the returning-use, identity-linking, and cancel checks from §2.
4. **Email confirmation** (prod-only divergence): create an email/password account in prod and
   confirm you receive a verification email and cannot sign in until you click it. This proves
   `enable_confirmations = true` actually landed on prod.

---

## 5. Log hygiene (do not skip)

OAuth authorization codes must never hit disk. After running the desktop flow, inspect the log:

```bash
# electron-log default location (Linux). Adjust app dir for prod vs dev build.
grep -iE 'code=|auth/callback\?' ~/.config/talysman/logs/main.log ~/.config/@talysman/desktop/logs/main.log 2>/dev/null
```

- The deep-link handler logs a **`logLabel`** that deliberately excludes query params
  (`apps/desktop/src/main/deepLink.ts`), so you should see `talysman://auth/callback` with **no**
  `?code=...`. Any bare authorization code in the logs is a leak — fix before release.

---

## 6. Quick failure map

| Symptom | Most likely cause |
|---|---|
| No Google button (web) | `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` false for this env; web not redeployed after `sync:env:prod`. |
| No Google button (desktop) | `GOOGLE_AUTH_ENABLED` was false at **build** time; needs a rebuild/new release. |
| `redirect_uri_mismatch` from Google | Supabase project callback missing from the Google client's Authorized redirect URIs (§7 of setup). |
| `Error 403: access_denied` on prod | Consent screen still in **Testing** and the account isn't a listed test user. |
| Browser completes but desktop never signs in | `talysman://auth/callback` not in the project's `additional_redirect_urls`, or the OS lost the `talysman://` protocol registration. |
| "email links must be opened on the computer that requested them" | PKCE verifier is machine-local by design — expected when a link is opened on a different device. |

---

## References

- Setup: `oauth-setup.md`
- Related native auth/payments flows: `auth-payments-verification.md`
