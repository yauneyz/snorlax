# Google OAuth Setup

Talysman uses Supabase Auth for Google account signup and sign-in. Google redirects to
Supabase first; it does **not** redirect directly to Talysman's `/api/auth/callback` or
`talysman://` URLs.

Keep this authentication client separate from the existing Google Search Console OAuth client.
The authentication client requests only basic identity information and does not need Search
Console access.

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

Add the following to the gitignored root `.credentials` file:

```toml
[google_auth]
enabled_dev = true
enabled_prod = false
client_id = "<your-client-id>.apps.googleusercontent.com"
client_secret = "<your-client-secret>"
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

## 7. Configure production Supabase

In **Supabase → Authentication → Sign In / Providers → Google**:

1. Enable Google.
2. Paste the production Google client ID and client secret.
3. Save the provider configuration.

Under **Authentication → URL Configuration**, set the production Site URL and ensure these exact
redirect URLs are allowed:

```text
https://<your-production-domain>/api/auth/callback
talysman://auth/callback
talysman://auth/reset-callback
```

Then change the root `.credentials` setting to:

```toml
[google_auth]
enabled_dev = true
enabled_prod = true
client_id = "<your-local-client-id>.apps.googleusercontent.com"
client_secret = "<your-local-client-secret>"
```

The `client_id` and `client_secret` in `.credentials` configure local Supabase. Production
credentials remain in the Supabase dashboard; `enabled_prod` controls whether production web
and desktop clients display Google authentication.

Sync the production feature flag:

```bash
pnpm sync:env:prod
```

## 8. Verify the integration

Test both the website and a packaged desktop build:

1. Sign up with a Google account that has never used Talysman.
2. Confirm Supabase creates one `auth.users` row and one corresponding `profiles` row.
3. Confirm the profile contains the expected email, name, and avatar.
4. Sign out, then use Google again and confirm it reuses the same account.
5. Start with an existing confirmed email/password account, then use Google with the same
   verified email. Confirm Supabase links the identity without creating a duplicate profile.
6. Cancel the Google chooser and confirm the initiating login/signup surface shows a recoverable
   error.
7. Test the desktop callback while Talysman is running and from a cold start.
8. Confirm desktop logs do not contain OAuth authorization codes.

## References

- [Supabase: Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase: Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Google: Manage OAuth clients](https://support.google.com/cloud/answer/15549257)
- [Google: OAuth brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
