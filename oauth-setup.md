# Google OAuth Setup

Talysman uses Supabase Auth for Google account signup and sign-in. Google redirects to
Supabase first; it does **not** redirect directly to Talysman's `/api/auth/callback` or
`talysman://` URLs.

The authentication and Google Search Console integrations can initially share one web client.
They can also use separate clients later if their consent-screen or deployment requirements
diverge.

## 1. Find the production Supabase callback URL

In the Supabase dashboard:

1. Open the production project.
2. Go to **Authentication → Sign In / Providers → Google**.
3. Copy the callback URL displayed there. It normally looks like:

   ```text
   https://<project-ref>.supabase.co/auth/v1/callback
   ```

Use the exact value shown by Supabase in the Google client configuration below.

## 2. Create a Google Cloud project

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Open the project selector and choose **New Project**.
3. Name it something like `Talysman Authentication`.
4. Create and select the project.

A separate project provides the cleanest separation from the Search Console integration.
Google also recommends separate testing and production projects, although one dedicated
authentication project is sufficient initially.

## 3. Configure Google Auth Platform

Open **Google Auth Platform → Get Started** and configure:

- App name: `Talysman`
- User support email: the Talysman support or administrator email
- Audience: **External**
- Developer contact email: an actively monitored address

Under **Branding**, add:

- Homepage: the production Talysman homepage
- Privacy policy: `https://<your-production-domain>/privacy`
- Terms: `https://<your-production-domain>/terms`
- Authorized domain: the base production domain

The application can remain in **Testing** during development. Add the required Google accounts
as test users if Google prompts for them. Publish and verify the branding before the public
production rollout.

## 4. Configure scopes

Under **Google Auth Platform → Data Access**, add only:

```text
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
```

Do not add `https://www.googleapis.com/auth/webmasters.readonly`; that belongs to the separate
Search Console connection flow.

## 5. Create the OAuth client

Go to **Google Auth Platform → Clients**:

1. Click **Create Client**.
2. Choose **Web application**.
3. Name it `Talysman Authentication`.
4. Add the following **Authorized JavaScript origins**:

   ```text
   http://localhost:3000
   https://<your-production-domain>
   ```

5. Add the following **Authorized redirect URIs**:

   ```text
   http://127.0.0.1:54321/auth/v1/callback
   https://<project-ref>.supabase.co/auth/v1/callback
   ```

   Replace the second value with the exact production callback copied from Supabase in step 1.
   Schemes, domains, ports, paths, and trailing slashes must match exactly.

6. Click **Create** and immediately save the generated:

   - Client ID
   - Client secret

Keep the client secret out of Git, browser configuration, and Electron builds.

## 6. Enable local development

Download the client JSON to the gitignored `oauth/google-web-client.json` path, then add the
following to the gitignored root `.credentials` file:

```toml
[google_auth]
enabled_dev = true
enabled_prod = false
credentials_file = "oauth/google-web-client.json"
```

To reuse this client for the server-side Search Console flow, also set:

```toml
[google]
oauth_credentials_file = "oauth/google-web-client.json"
```

Generate the local configuration and restart Supabase Auth:

```bash
pnpm sync:env
pnpm dev:down
pnpm dev
```

The restart is required because Supabase Auth reads provider configuration when its container
starts. `pnpm sync:env` writes the Google secret to the gitignored `apps/web/.env`; web and
desktop clients receive only an enabled/disabled flag.

## 7. Add the production redirect URI to the Google client

The desktop app and web app both complete OAuth at Supabase's hosted callback, so the
**production** Supabase callback must be an Authorized redirect URI on the Google client — in
addition to the local one from step 5.

In **Google Auth Platform → Clients → `Talysman Authentication`**, confirm the Authorized
redirect URIs include:

```text
http://127.0.0.1:54321/auth/v1/callback
https://lkanoehzgogtrxzycutl.supabase.co/auth/v1/callback
```

The second is the production project (`lkanoehzgogtrxzycutl`) callback. Without it, prod OAuth
fails with `redirect_uri_mismatch`.

> The committed `oauth/google-web-client.json` is a *download* of the client and does **not**
> list `redirect_uris`/`javascript_origins` — those live in the Google Console, not the JSON.
> A missing key in the file tells you nothing; verify in the Console.

Also confirm the OAuth consent screen is **Published**, not in **Testing** — a Testing app only
lets explicitly listed test users sign in to production.

## 8. Configure production Supabase auth (CLI)

Production auth settings (site URL, redirect allow-list, Google provider, email confirmation)
are managed as code via the `[remotes.prod]` block in `apps/web/supabase/config.toml` and pushed
with the Supabase CLI. This replaces clicking through the dashboard.

**Why a `[remotes.prod]` block exists separately from the base config:** `supabase config push`
sends the *merged* config, so any prod-sensitive value must be **restated** under
`[remotes.prod]` or it inherits the local-dev value. The most important divergence is email
confirmation — local dev keeps `enable_confirmations = false` for fast test signups, but prod
sets it `true` so users must verify address ownership. `redirect_uri` under
`[auth.external.google]` is local-only and is intentionally *not* restated (the management API
has no field for it; the hosted callback is derived from the project ref).

Link once (from `apps/web`), then push:

```bash
cd apps/web
supabase link --project-ref lkanoehzgogtrxzycutl

# Secrets are read straight out of the gitignored JSON, never echoed or committed.
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=$(jq -r .web.client_id ../oauth/google-web-client.json) \
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET=$(jq -r .web.client_secret ../oauth/google-web-client.json) \
supabase config push --project-ref lkanoehzgogtrxzycutl
```

This push is safe to run before the feature is enabled — nothing user-visible changes until the
`enabled_prod` flag flips (step 9), because both web and desktop hide the Google buttons while
the flag is false.

## 9. Enable Google auth in production

Flip the flag in the root `.credentials` file:

```toml
[google_auth]
enabled_dev  = true
enabled_prod = true
credentials_file = "oauth/google-web-client.json"
```

`enabled_prod` is the single switch that reveals Google authentication in production web and
desktop clients. The client ID/secret are supplied to Supabase by the push in step 8; they never
ship to clients — web and desktop receive only the enabled/disabled flag.

Then propagate the flag to each client:

- **Web** — `pnpm sync:env:prod` writes `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` (to Vercel when
  `VERCEL_ENV` targets prod). Redeploy the web app to pick it up.
- **Desktop** — the flag is **baked in at build time** (`GOOGLE_AUTH_ENABLED` →
  `__APP_CONFIG__` in `apps/desktop/electron.vite.config.ts`). Existing installs will **not**
  pick it up. You must cut a **new desktop release** and let auto-update ship it.

## 10. Verify

See **`oauth-verification.md`** for the full dev + prod end-to-end verification runbook (both web
and a packaged desktop build, account linking, cold-start deep links, and log hygiene).

## References

- [Supabase: Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase: Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Google: Manage OAuth clients](https://support.google.com/cloud/answer/15549257)
- [Google: OAuth brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
