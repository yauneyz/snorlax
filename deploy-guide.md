# Talysman Deploy Guide

How the web app (`apps/web`) and desktop app (`apps/desktop` plus the native service) get
configured, run locally, and released to production. Covers Supabase, Vercel, Stripe,
env plumbing, signed desktop updates, the Linux APT repository, S3 release hosting, and
the runbooks for day-to-day dev and production updates.

Commands and repository paths here are maintained with the code. Infrastructure state is
intentionally not snapshotted: use the verification commands in §4 to inspect the live services
before a deployment.

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

| Piece            | Dev                                                     | Prod                                                                                                     |
| ---------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Web app          | `next dev` on `localhost:3000`                          | Vercel project **snorlax-web** (root dir `apps/web`)                                                     |
| Desktop app      | Electron dev build + mock/native service                | Signed NSIS (Windows), signed/notarized DMG + ZIP updater payload (macOS), signed APT repository (Linux) |
| Desktop updates  | Disabled for unpackaged builds                          | Generic updater feed in S3 on Windows/macOS; APT on Linux                                                |
| Release hosting  | None                                                    | `talysman-release-artifacts-prod` in `us-east-1`                                                         |
| Database + auth  | Local Supabase stack (Docker, `supabase start`)         | Cloud project `lkanoehzgogtrxzycutl.supabase.co`                                                         |
| Stripe           | Test mode + `stripe listen` webhook forwarding          | Live mode + dashboard webhook endpoint                                                                   |
| LLM              | Local vLLM (`LLM_PROVIDER=local`)                       | OpenAI (`LLM_PROVIDER=openai`)                                                                           |
| App URL          | `http://localhost:3000`                                 | `https://talysman.app`                                                                                   |
| Email            | Inbucket (local mail catcher, port 54324)               | Resend                                                                                                   |
| Sentry / PostHog | Disabled (placeholder values auto-detected and skipped) | Enabled when real values are in `.credentials`                                                           |

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
The desktop production env derives `UPDATE_FEED_URL` from
`extension_hosting.public_s3_base_url` and appends `/desktop`.

If validation fails, sync-env prints exactly which field is wrong and exits — so a typo
here fails loudly at sync time, not at request time in production.

### `scripts/sync-env.ts` — the four ways it runs

| Command (from `apps/web`)      | What it does                                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm sync:env`                | mode=dev → writes `apps/web/.env.local` (dev Supabase, local LLM) and root `.env.local` (desktop `VITE_*` vars). Runs automatically before `pnpm dev` (`predev` hook).                                 |
| `pnpm sync:env -- --mode=prod` | Same two files but with prod values (cloud Supabase, OpenAI, `https://talysman.app`). This is what `pnpm prod` does before starting `next dev`.                                                        |
| `pnpm sync:env:build`          | Runs before `pnpm build` (`prebuild` hook). On a Vercel build (`VERCEL=1`) with no `.credentials` present it **skips entirely** and lets Vercel's own env vars win. Locally it writes prod-mode files. |
| `pnpm sync:env:prod`           | **Upserts** every non-empty var to Vercel's _production_ environment. Does not write local files.                                                                                                      |
| `pnpm sync:env:preview`        | Upserts the same prod-mode values to Vercel's _preview_ environment. Does not write local files.                                                                                                       |

Gotchas baked into the script (worth knowing, they will bite otherwise):

- Vercel syncs are idempotent: the script lists remote metadata, updates existing
  app-owned variables, and adds missing variables without first deleting them.
- Variables owned by a Vercel integration are preserved. For example, the Supabase
  integration remains the source of truth for the variables it manages.
- Known server secrets are stored as Vercel sensitive variables. Values are piped over
  stdin and are never printed by the script.
- Empty values are skipped on push, so optional stuff (Sentry, PostHog) never creates
  empty vars on Vercel.
- Prod mode **requires** `openai.api_key` to be set, because prod uses OpenAI.
- Placeholder detection: values containing `...` (from the example file) are treated as
  "unset" for PostHog/Sentry, so a half-filled `.credentials` degrades gracefully.

### `apps/web/src/lib/config.ts` — runtime validation

Application modules normally import the typed `config` object, which zod-validates the env at
module load. Bootstrap files that Next.js must statically analyze and the small OAuth/encryption
key helpers read their literal `process.env` keys directly. Consequences:

- A missing required var crashes the server **at startup/build**, not on the first
  request that happens to need it. If a Vercel build fails with "Invalid … env config",
  the error names the exact missing variable.
- `NEXT_PUBLIC_*` vars are **inlined into the client bundle at build time** by Next.js.
  Changing one on Vercel does nothing until you rebuild/redeploy.
- Supabase key naming: the app canonically uses `NEXT_PUBLIC_SUPABASE_ANON_KEY`, but
  `config.ts` falls back to `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — that's the name the
  Supabase↔Vercel marketplace integration injects. Either satisfies the schema.

### How the app talks to Supabase (four clients)

| File                                                   | Key used                       | Where it runs                                                                           |
| ------------------------------------------------------ | ------------------------------ | --------------------------------------------------------------------------------------- |
| `src/lib/supabase/browser.ts`                          | publishable key                | Client components (RLS enforced)                                                        |
| `src/lib/supabase/server.ts`                           | publishable key + user cookies | Server components / route handlers (RLS enforced as the user)                           |
| `src/lib/supabase/middleware.ts` → `src/middleware.ts` | publishable key                | Node middleware; refreshes auth cookies, gates `/app/**` on login + active subscription |
| `src/lib/supabase/admin.ts`                            | **secret key — bypasses RLS**  | Server-only (webhook, `src/server/**`); an eslint rule blocks importing it elsewhere    |

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

| Service                            | URL                      |
| ---------------------------------- | ------------------------ |
| API (what the app talks to)        | `http://127.0.0.1:54321` |
| Postgres                           | `127.0.0.1:54322`        |
| Studio (dashboard UI)              | `http://127.0.0.1:54323` |
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

## 4. Verify the live production state

Do not rely on a checked-in snapshot for deploy status, environment variables, migration history,
or DNS. Check the live systems immediately before changing them:

```bash
vercel whoami
vercel project inspect
vercel env ls production

cd apps/web
supabase migration list
```

Also verify the production and health URLs directly:

```bash
curl -I https://talysman.app
curl https://talysman.app/api/health
```

The remaining sections describe the intended configuration and the commands used to establish it.

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
2. **Auth → Providers**: email settings (confirmations are _off_ locally; decide
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

The command is safe to re-run after any `.credentials` change. It creates missing
variables and updates existing variables in place. To inspect what would be synced
without changing Vercel, run `pnpm sync:env:prod -- --dry-run` from the repository root.

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
- `sync:env:prod` only populates the **production** environment. Run
  `pnpm sync:env:preview` if Git preview builds should use the same prod-mode services.
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

## 8. Desktop releases and auto-update

### 8.1 Release architecture

`electron-builder.yml` produces these release targets:

| Platform    | Installer/update payload                                     | Update prefix        |
| ----------- | ------------------------------------------------------------ | -------------------- |
| Windows x64 | Authenticode-signed NSIS `.exe`                              | `desktop/win/x64/`   |
| macOS arm64 | Developer ID-signed/notarized `.dmg`; `.zip` for auto-update | `desktop/mac/arm64/` |
| Linux amd64 | `.deb` in a signed APT repository                            | `apt/`               |

The current GitHub-hosted `macos-latest` runner is arm64. Intel macOS, Windows arm64,
and Linux arm64 need separate build jobs and architecture-aware website download
routing before they are advertised.

Windows/macOS updater behavior:

- Packaged builds check 30 seconds after startup and every six hours.
- Payloads download automatically, but `autoInstallOnAppQuit` is disabled.
- A restart prompt appears only when Focus is inactive or the paired key is present.
- If a new app detects an older privileged service, it runs the bundled controller with
  elevation, restarts the service, and waits up to 60 seconds for the matching version.
- Native service install/repair is idempotent and preserves the original recovery-code
  hash/file on Windows, macOS, and Linux.

Electron's updater is intentionally disabled on Linux. `apt upgrade` replaces the DEB,
and the package hook restarts the systemd service in place.

### 8.2 AWS release infrastructure

Live AWS state:

- Bucket: `talysman-release-artifacts-prod` (`us-east-1`).
- Public read is limited to `app/`, `ext/`, `desktop/`, and `apt/`.
- S3 Versioning is enabled for overwrite/delete recovery.
- Lifecycle rule `BoundReleaseArtifactHistory` removes noncurrent versions after 14
  days and incomplete multipart uploads after seven days.
- GitHub OIDC role: `arn:aws:iam::318527158633:role/TalysmanGitHubRelease`.
- The role trust is limited to `repo:yauneyz/snorlax:environment:production`; its S3
  write/delete access is limited to `app/`, `desktop/`, and `apt/`.

Reapply either configuration idempotently with an administrative ambient AWS CLI
session:

```bash
pnpm infra:release-bucket
pnpm infra:release-iam
```

The IAM script deliberately does not use the restricted uploader credentials from
`.credentials`. Optional overrides are `GITHUB_RELEASE_REPOSITORY`,
`GITHUB_RELEASE_ENVIRONMENT`, and `AWS_RELEASE_ROLE_NAME`.

### 8.3 Optional GitHub CI configuration

This section is only needed if releases will be built by GitHub Actions. The normal
manual release procedure in §8.4 does not require GitHub Actions, a release tag, or the
GitHub OIDC role. Local release hosts instead use the AWS uploader credentials from
`.credentials` (or the equivalent `AWS_*` and `RELEASE_*` environment variables) and
their locally configured signing credentials.

Create a protected GitHub environment named exactly `production`. Configure:

Repository/environment variables:

- `AWS_REGION=us-east-1`
- `AWS_RELEASE_ROLE_ARN=arn:aws:iam::318527158633:role/TalysmanGitHubRelease`
- `RELEASE_ARTIFACTS_BUCKET=talysman-release-artifacts-prod`
- `RELEASE_PUBLIC_BASE_URL=https://talysman-release-artifacts-prod.s3.us-east-1.amazonaws.com`
- `APT_SIGNING_KEY_ID=<full OpenPGP fingerprint>`

Secrets:

- Windows: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`.
- macOS signing: `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`.
- Apple notarization: `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`,
  `APPLE_API_ISSUER`, `APPLE_TEAM_ID`.
- APT: base64 `APT_GPG_PRIVATE_KEY`, plus optional
  `APT_SIGNING_KEY_PASSPHRASE`.

Never add AWS access keys to GitHub. The workflow uses OIDC. Production Windows/macOS
builds fail closed when signing credentials are absent because `forceCodeSigning` is
enabled.

### 8.4 Publish manually from Linux and macOS

This is the normal release path when GitHub CI is not being used. Run the version
command once, publish Linux and Windows from Linux, and publish macOS from a Mac.

#### Before each release

- Both computers must use the same clean, committed source revision and have
  dependencies installed with `pnpm install --frozen-lockfile`.
- Both computers need S3 uploader configuration in `.credentials`, or equivalent
  `AWS_*`, `RELEASE_ARTIFACTS_BUCKET`, and `RELEASE_PUBLIC_BASE_URL` environment
  variables.
- Linux needs the APT secret key in its GPG keyring and the key identified either by
  `[apt].signing_key_id` in `.credentials` (the normal local path) or an exported
  `APT_SIGNING_KEY_ID` (which wins when both are set), plus
  `dpkg-scanpackages`, the Nix Rust/cargo-xwin toolchain, Wine, and Windows signing
  credentials (`WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`).
- macOS needs the Developer ID certificate (`CSC_LINK` and `CSC_KEY_PASSWORD`) and
  Apple notarization credentials (`APPLE_API_KEY`, `APPLE_API_KEY_ID`,
  `APPLE_API_ISSUER`, and `APPLE_TEAM_ID`). `APPLE_API_KEY` is the absolute path to the
  App Store Connect `.p8` key.

#### 1. Set and commit the version once

On Linux, choose a new SemVer that is higher than every published version:

```bash
pnpm release:version -- 0.1.2
git diff
git add package.json apps/desktop/package.json native
git commit -m "Release desktop v0.1.2"
```

The version command updates every app/native manifest and refreshes the Cargo lockfiles;
it does not build, upload, change dependencies, or modify `pnpm-lock.yaml`. Push the
normal branch commit, or otherwise copy/check out this exact commit on the Mac. Do not
push a `v*` tag when avoiding CI because that tag starts the GitHub release workflow.

#### 2. Build and upload Linux and Windows from Linux

From the committed release revision on Linux:

```bash
pnpm release:both
```

Yes, `release:both` uploads. It performs these operations sequentially:

1. Build Linux, upload the DEB/stable download, and publish the signed APT repository.
2. Verify and fully promote the Linux release.
3. Cross-build and Authenticode-sign Windows x64 through Wine.
4. Upload and promote the Windows installer and auto-update feed.

The command stops immediately if either platform fails. It does not change the version.
The default retention is the current and previous generation; use
`pnpm release:both -- --retain 2` only if spelling that default out is useful.

#### 3. Build and upload macOS from the Mac

Check out the same release commit on the Mac, then run:

```bash
pnpm install --frozen-lockfile
pnpm release:upload -- --require mac
```

On macOS, `release:upload` builds, embeds the Safari Web Extension, signs, notarizes, uploads,
promotes, and verifies the macOS artifacts. `--require mac` is a safety assertion; it prevents an
accidental run on the wrong host.

#### 4. Verify the complete release

After both computers finish successfully, run from either computer:

```bash
pnpm release:verify
```

This is read-only and checks the live Windows, macOS, Linux download, and APT state.
Each upload command also verifies its own platform before returning, but this final
command confirms the combined release.

Both publishers are safe to rerun with the same committed version after an interrupted
or failed upload. Do not reuse a version for different code and do not roll back by
overwriting an existing version; fix the problem and publish a higher SemVer.

#### Other manual commands

For a traditional native three-machine release, run
`pnpm release:upload -- --require <win|mac|linux>` on each matching OS. To publish only
Windows from Linux, use `pnpm release:upload:win`. `pnpm release:apt` is available only
to repair or republish APT metadata after a Linux build; it is not the normal release
path.

This uses `cargo-xwin` plus the `x86_64-pc-windows-msvc` Rust standard library for the
native service and Wine for electron-builder/NSIS. Those are declared in
`~/nixos-config/modules/home/languages/rust.nix`; apply that configuration with
`bash ~/nixos-config/scripts/rebuild.sh`. Regular software Authenticode certificates
are supported on Linux. EV hardware-backed certificates may need a custom
`osslsigncode`/JSign integration or the native Windows GitHub job.

Desktop release commands do not change Vercel environment variables. Web env sync and web
deployment remain separate operations. On Linux it requires `APT_SIGNING_KEY_ID`,
`dpkg-scanpackages`, and the corresponding secret key in the GPG keyring; it promotes
the signed APT repository as part of the same command.

#### Optional tag-triggered GitHub release

If the optional configuration in §8.3 is complete, pushing a tag such as `v0.1.2`
instead runs `.github/workflows/release-desktop.yml`. It builds each platform on its
native GitHub runner, assumes the OIDC role, publishes all three releases, and runs the
live verifier. Do not use the tag workflow and the manual workflow for the same release.

APT is not a hosted service and requires no vendor account. Talysman owns this APT
repository inside the existing S3 bucket; its trust root is the OpenPGP key you create
and distribute as `talysman-archive-keyring.gpg`.

Create that key once with:

```bash
gpg --batch --passphrase '' --quick-generate-key \
  "Talysman Release Signing <releases@talysman.app>" rsa4096 sign never
gpg --list-secret-keys --keyid-format=long   # copy the 40-char fingerprint
```

Put the fingerprint in `[apt].signing_key_id` in `.credentials`. For CI, also set the
`APT_SIGNING_KEY_ID` variable and the `APT_GPG_PRIVATE_KEY` secret from
`gpg --export-secret-keys --armor <fingerprint> | base64 -w0`. Back the secret key and
its revocation certificate (`~/.gnupg/openpgp-revocs.d/<fingerprint>.rev`) up offline —
losing the key breaks `apt update` for every installed client until they manually
install a replacement keyring.

### 8.5 Promotion and retention guarantees

Website downloads retain stable keys under `app/`. Windows/macOS update payloads have
versioned immutable names. The publisher uploads every referenced payload first,
uploads `latest.yml`/`latest-mac.yml` last, verifies the public pointer and website
alias, and only then prunes. The default is two live payload generations, so a client
that fetched the previous metadata does not race deletion.

The APT publisher uploads the new DEB and content-addressed `by-hash` indexes first,
then promotes the signed `InRelease` pointer. It keeps current plus previous package
and index generations. S3's 14-day noncurrent-version window is a separate recovery
layer and is not exposed as a normal download generation.

Do not roll a desktop release backward by replacing an existing version. Publish a
higher fixed SemVer. For exact signing, installation, recovery-code, race, and failure
tests, follow [`auto-update-verification.md`](./auto-update-verification.md).

## 9. Runbooks

### Daily dev

```bash
pnpm dev                             # Supabase + Stripe forwarding + web + Electron
# schema change: supabase migration new x → edit SQL → supabase db reset
pnpm dev:down                        # optional: stop Supabase when done
```

Ctrl+C or closing the terminal stops the three attached processes but leaves Supabase
running for faster restarts. Use `pnpm dev:desktop` when only the Electron app is needed.

### Install a production build locally

```bash
pnpm release:local                  # build and install on this machine only
```

This command does not sync credentials, upload artifacts, or change cloud hosting.
Use `pnpm release:upload` for those release operations.

### Ship a desktop release

This is the short form of the manual, no-GitHub-CI procedure in §8.4. Replace `0.1.2`
with a new version higher than production.

```bash
# On Linux: version once, review, and commit.
pnpm release:version -- 0.1.2
git diff
git add package.json apps/desktop/package.json native
git commit -m "Release desktop v0.1.2"

# Still on Linux: build and UPLOAD Linux, APT, and Windows.
pnpm release:both

# On the Mac, at that exact same commit: build and UPLOAD macOS.
pnpm install --frozen-lockfile
pnpm release:upload -- --require mac

# From either machine, after both upload commands succeed:
pnpm release:verify
```

`release:version` does not upload. `release:both` uploads Linux and Windows;
`release:upload -- --require mac` uploads macOS. No release tag is needed. Desktop
release commands do not change Vercel variables or deploy the website.

### Ship a web/database change to prod

```bash
# 1. Schema first (safe: additive migrations deploy before the code that uses them)
cd apps/web && supabase db push

# 2. Production web environment
pnpm sync:env:prod                   # upsert .credentials values to Vercel

# 3. Web code
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

## 10. Mental model summary

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
- **Desktop releases are immutable payloads plus mutable pointers.** Upload and verify
  payloads first, promote metadata last, and retain the immediately previous
  generation. Never hand-edit `latest*.yml` in S3.
- **Linux follows the OS package manager.** APT signatures and `Acquire-By-Hash` provide
  update integrity/atomicity; Electron auto-update remains Windows/macOS-only.
