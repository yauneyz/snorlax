# SaaS Starter — Implementation Plan

> **Deliverable note:** This file is the working plan. After approval, copy its contents to `saas-starter.md` at the repo root; it is intended to be detailed enough that an LLM (or engineer) can execute end-to-end given only the `.credentials`.

---

## 1. Context

We are building a reusable SaaS starter that turns a filled-in `.credentials` file into a running, production-shaped app on Vercel + Supabase. The starter itself has no product features — just the plumbing every SaaS needs: auth, subscriptions, billing portal, marketing surface, content pipeline, analytics, observability, and transactional email.

**Stack (all locked in by prompt):** Next.js App Router + React + TypeScript, custom CSS (written later, just good class names for now), Supabase (auth/Postgres/storage/realtime/edge functions), Zod, TanStack Query, Stripe, Resend, Sentry, PostHog, Google Analytics 4, Google Search Console, Vercel hosting.

**Decisions confirmed with user:**
- Individual-user accounts (no teams/orgs).
- Single paid tier, monthly + yearly prices. Paywall is absolute: no free tier bypass.
- Auth: email+password **and** Google OAuth, via Supabase.
- Authed app route is a minimal placeholder dashboard (welcome + manage billing + sign out).
- Package manager: `pnpm`.
- Testing: Vitest (unit), Playwright (E2E), Stripe CLI webhook harness.
- Secrets: single gitignored `.credentials` (TOML) + `scripts/sync-env.ts` generator → `.env.local`.
- No GitHub Actions CI; rely on Vercel build checks.

---

## 2. Repository layout

```
/
├── .credentials                      # gitignored, single source of truth for secrets
├── .credentials.example              # committed; documents every key
├── .env.local                        # gitignored, generated from .credentials
├── .gitignore
├── package.json
├── pnpm-lock.yaml
├── next.config.ts
├── tsconfig.json
├── eslint.config.mjs
├── vitest.config.ts
├── playwright.config.ts
├── sentry.client.config.ts
├── sentry.server.config.ts
├── sentry.edge.config.ts
├── scripts/
│   ├── sync-env.ts                   # .credentials → .env.local (+ optional `vercel env push`)
│   └── stripe-test.ts                # spawns `stripe listen` + replays fixture events
├── supabase/
│   ├── config.toml                   # for `supabase` CLI local dev
│   ├── migrations/
│   │   └── 0001_init.sql             # profiles, subscriptions, RLS, triggers
│   └── seed.sql                      # optional; empty by default
├── content/
│   ├── blog/
│   │   ├── hello-world.md            # example post
│   │   └── resources/                # images referenced by blog posts
│   │       └── .gitkeep
│   └── legal/
│       ├── privacy.md
│       └── terms.md
├── emails/                           # react-email templates
│   ├── WelcomeEmail.tsx
│   ├── PaymentFailedEmail.tsx
│   └── SubscriptionCancelledEmail.tsx
├── public/
│   ├── favicon.ico
│   └── og-default.png
├── src/
│   ├── middleware.ts                 # auth + subscription gate
│   ├── app/
│   │   ├── layout.tsx                # root layout: Providers, Sentry, PostHog, GA4, <head>
│   │   ├── providers.tsx             # TanStack Query + PostHog + Supabase session
│   │   ├── globals.css               # empty placeholder; CSS comes later
│   │   ├── sitemap.ts                # dynamic: marketing + blog
│   │   ├── robots.ts
│   │   ├── not-found.tsx
│   │   ├── (marketing)/              # public, indexable
│   │   │   ├── layout.tsx            # marketing shell (header/footer)
│   │   │   ├── page.tsx              # landing (/)
│   │   │   ├── pricing/page.tsx
│   │   │   ├── blog/
│   │   │   │   ├── page.tsx          # index
│   │   │   │   └── [slug]/page.tsx
│   │   │   ├── privacy/page.tsx
│   │   │   └── terms/page.tsx
│   │   ├── (auth)/
│   │   │   ├── layout.tsx
│   │   │   ├── login/page.tsx
│   │   │   ├── signup/page.tsx
│   │   │   ├── forgot-password/page.tsx
│   │   │   └── reset-password/page.tsx
│   │   ├── (app)/
│   │   │   ├── layout.tsx            # requires auth+active sub (belt-and-braces over middleware)
│   │   │   ├── app/page.tsx          # placeholder dashboard
│   │   │   └── account/page.tsx      # email, password change, manage billing
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   └── callback/route.ts # Supabase OAuth/PKCE callback
│   │   │   ├── stripe/
│   │   │   │   ├── checkout/route.ts # creates Checkout Session
│   │   │   │   ├── portal/route.ts   # creates Billing Portal Session
│   │   │   │   └── webhook/route.ts  # signed Stripe webhook handler
│   │   │   ├── blog/
│   │   │   │   └── resources/[...path]/route.ts # streams /content/blog/resources/*
│   │   │   └── health/route.ts
│   ├── components/
│   │   ├── marketing/                # Header, Footer, PricingCard, BlogCard, etc.
│   │   ├── auth/                     # LoginForm, SignupForm, OAuthButtons, etc.
│   │   ├── app/                      # AppHeader, SignOutButton, ManageBillingButton
│   │   └── content/                  # MarkdownRenderer, BlogImage
│   ├── lib/
│   │   ├── config.ts                 # env parsing via Zod; typed config object
│   │   ├── supabase/
│   │   │   ├── browser.ts            # createBrowserClient
│   │   │   ├── server.ts             # createServerClient (RSC/route handlers)
│   │   │   ├── middleware.ts         # createMiddlewareClient (edge)
│   │   │   └── admin.ts              # secret-key client (server-only)
│   │   ├── stripe/
│   │   │   ├── client.ts             # Stripe SDK, keyed by env
│   │   │   ├── checkout.ts           # create Checkout Session
│   │   │   ├── portal.ts             # create Billing Portal Session
│   │   │   └── sync-subscription.ts  # upsert subscriptions table from Stripe event
│   │   ├── resend/
│   │   │   ├── client.ts
│   │   │   └── send.ts               # typed `sendEmail({ to, template, props })`
│   │   ├── analytics/
│   │   │   ├── posthog-client.ts
│   │   │   └── ga4.tsx               # @next/third-parties GoogleAnalytics
│   │   ├── sentry/
│   │   │   └── index.ts              # helpers for captureException
│   │   ├── content/
│   │   │   ├── blog.ts               # list/get posts, parse frontmatter
│   │   │   └── legal.ts              # render privacy/terms
│   │   ├── zod/
│   │   │   ├── auth.ts               # login/signup/reset schemas
│   │   │   ├── checkout.ts
│   │   │   └── blog-frontmatter.ts
│   │   ├── auth/
│   │   │   ├── require-user.ts       # RSC helper; redirects to /login if anon
│   │   │   └── require-subscribed.ts # RSC helper; redirects to /pricing if no sub
│   │   └── query/
│   │       └── client.ts             # TanStack QueryClient factory
│   └── server/                       # any server-only modules not under app/api
├── tests/
│   ├── unit/
│   │   ├── config.test.ts
│   │   ├── blog.test.ts
│   │   └── stripe-sync.test.ts
│   └── e2e/
│       ├── fixtures/
│       ├── marketing.spec.ts
│       ├── auth.spec.ts
│       ├── checkout.spec.ts
│       └── webhook.spec.ts
```

**Why this shape:** App Router route groups `(marketing)`, `(auth)`, `(app)` give each surface its own layout without affecting URL. Server-only code lives under `src/lib/**` or route handlers; the `admin` Supabase client is import-restricted via an eslint rule so it can never be bundled client-side.

---

## 3. Secrets — `.credentials` spec

**Format:** TOML (stdlib-ish, easy to hand-edit, supports sections).

**Location:** repo root, gitignored. Paired with `.credentials.example` in git.

```toml
# .credentials.example
[app]
name          = "My SaaS"                # appears in metadata, emails
url           = "https://example.com"    # public production URL
environment   = "development"            # development | production

[supabase]
url                 = "https://xxxxx.supabase.co"
publishable_key     = "sb_publishable_..."
secret_key          = "sb_secret_..."    # server-only
project_ref         = "xxxxx"            # for CLI

[stripe]
mode                    = "test"         # test | live — switches which keys are exported
publishable_key_test    = "pk_test_..."
secret_key_test         = "sk_test_..."
webhook_secret_test     = "whsec_..."
publishable_key_live    = "pk_live_..."
secret_key_live         = "sk_live_..."
webhook_secret_live     = "whsec_..."
price_id_monthly        = "price_..."
price_id_yearly         = "price_..."
portal_configuration_id = "bpc_..."      # optional; else Stripe uses default

[resend]
api_key  = "re_..."
from     = "My SaaS <hello@example.com>"

[sentry]
dsn          = "https://...@sentry.io/..."
org          = "my-org"
project      = "my-saas"
auth_token   = "sntrys_..."              # used by sentry/nextjs at build for source maps

[posthog]
key  = "phc_..."
host = "https://us.i.posthog.com"

[google]
ga4_measurement_id          = "G-XXXXXXXXXX"
search_console_verification = "abcdef..."  # meta tag content
oauth_client_id             = "...apps.googleusercontent.com"
oauth_client_secret         = "GOCSPX-..."
```

**Generator: `scripts/sync-env.ts`**

- Parses `.credentials` with `@iarna/toml`.
- Validates shape with Zod — missing required keys fail loudly with exact path.
- Picks Stripe keys based on `stripe.mode` (test vs live).
- Writes `.env.local` with the canonical names Next.js/Supabase/Stripe expect:
  - `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_APP_NAME`, `APP_ENVIRONMENT`
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEY`
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`, `STRIPE_PORTAL_CONFIG_ID`
  - `RESEND_API_KEY`, `RESEND_FROM`
  - `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`
  - `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`
  - `NEXT_PUBLIC_GA4_MEASUREMENT_ID`, `GOOGLE_SITE_VERIFICATION`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
- `--production` flag: instead of writing `.env.local`, pipes each value to `vercel env add <name> production` (assumes `vercel` CLI is authed).

**Runtime config: `src/lib/config.ts`**

One typed object assembled once at module load, with Zod validation. Everything else in the app imports from here — never `process.env` directly. This is what catches a missing key at boot rather than at request time.

**pnpm scripts:**
```json
"sync:env": "tsx scripts/sync-env.ts",
"sync:env:prod": "tsx scripts/sync-env.ts --production",
"predev": "pnpm sync:env",
"prebuild": "pnpm sync:env"
```

---

## 4. Database schema (Supabase / Postgres)

File: `supabase/migrations/0001_init.sql`

```sql
-- profiles: one row per auth.users row. Holds Stripe customer linkage.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- subscriptions: projection of Stripe state, kept in sync by webhook.
create type public.subscription_status as enum (
  'trialing','active','past_due','canceled','incomplete','incomplete_expired','unpaid','paused'
);

create table public.subscriptions (
  id text primary key,                          -- Stripe subscription id (sub_...)
  user_id uuid not null references public.profiles(id) on delete cascade,
  status public.subscription_status not null,
  price_id text not null,                       -- Stripe price id
  quantity int not null default 1,
  cancel_at_period_end boolean not null default false,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  cancel_at timestamptz,
  canceled_at timestamptz,
  trial_start timestamptz,
  trial_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_user_id_idx on public.subscriptions(user_id);
create index subscriptions_status_idx on public.subscriptions(status);

-- View used by middleware & RSC to answer "is this user entitled?"
create or replace view public.active_subscriptions as
  select * from public.subscriptions
   where status in ('trialing','active')
     and current_period_end > now();

-- RLS
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;

create policy "profiles: owner read"  on public.profiles for select using (auth.uid() = id);
create policy "profiles: owner update" on public.profiles for update using (auth.uid() = id);
-- No insert policy: profiles are created by trigger, not by client.

create policy "subscriptions: owner read" on public.subscriptions for select using (auth.uid() = user_id);
-- No insert/update/delete policies: only service role (webhook) writes.

-- Trigger: auto-create profile when auth.users row is created.
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute procedure public.handle_new_user();

-- updated_at maintenance
create function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute procedure public.set_updated_at();
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute procedure public.set_updated_at();
```

**Why this shape:** `subscriptions` is a pure projection of Stripe — webhook is the only writer. RLS makes the client's direct reads safe for the middleware query. Using a view (`active_subscriptions`) keeps the "entitled?" query short and lets us tweak the definition in one place.

---

## 5. Auth flow + middleware gate

### Pages

- `/login` — email+password + Google button. On success → `/app` (middleware reroutes if no sub).
- `/signup` — same; on success sends Supabase confirmation email, then signs in (Supabase can be configured to auto-confirm in dev).
- `/forgot-password` — triggers `supabase.auth.resetPasswordForEmail(email, { redirectTo: /reset-password })`.
- `/reset-password` — reads recovery token from URL fragment, sets new password.
- `/api/auth/callback` — OAuth/PKCE code exchange; then redirect to `?next=` or `/app`.

### Middleware: `src/middleware.ts`

Runs on every request except static assets. For each request:
1. Build a Supabase middleware client that can refresh cookies.
2. Classify the path: `marketing | auth | app | api | asset`.
3. Fetch session (cheap) and, if present, fetch from `active_subscriptions` where `user_id = auth.uid()` limit 1.
4. Apply rules:
   - `marketing` path + authenticated + subscribed → **no redirect** (user can still browse marketing; only `/` redirects to `/app`, per prompt). Keep this narrow: only `pathname === '/'` redirects logged-in subscribed users to `/app`.
   - `marketing` path + authenticated + no sub → if `pathname === '/'`, redirect to `/pricing`.
   - `auth` path + already authenticated → redirect to `/app` (which will bounce to `/pricing` if unsubscribed).
   - `app` path + anonymous → redirect to `/login?next=<pathname>`.
   - `app` path + authenticated + no sub → redirect to `/pricing`.
   - `api` path → pass through (route handlers do their own checks).

Matcher excludes `/_next`, `/api/stripe/webhook`, `/api/auth/callback`, static files.

### RSC helpers (defense in depth)

`requireUser()` and `requireSubscribed()` are called in `(app)/layout.tsx` and in any protected route handler. They use the server Supabase client and redirect/throw on failure. Middleware alone is not trusted — it can be skipped if matchers are misconfigured.

---

## 6. Stripe integration

### Setup (one-time, manual in Stripe Dashboard)

Documented in `saas-starter.md`:
1. Create Product → add two Prices (monthly, yearly recurring).
2. Configure Customer Portal → enable: cancel, update payment method, view invoices, switch between the two prices. Save `bpc_...` id into `.credentials`.
3. Enable **automatic receipts** in Stripe settings (handles invoice/receipt emails for free).
4. Add webhook endpoint `https://<app-url>/api/stripe/webhook` subscribed to: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`, `charge.refunded`. Copy the `whsec_...` into `.credentials` (both test and live).
5. For Google OAuth: add redirect URI `https://<supabase-project>.supabase.co/auth/v1/callback` in GCP; paste client id/secret into Supabase Auth settings → Google provider.

### Checkout — `POST /api/stripe/checkout`

Body (Zod): `{ price: 'monthly' | 'yearly' }`.
1. `requireUser()`.
2. Load profile; if no `stripe_customer_id`, create a Stripe customer with `email` and `metadata.user_id`, store id on profile.
3. Create Checkout Session:
   - `mode: 'subscription'`, single line item from chosen price id, `customer: stripe_customer_id`, `allow_promotion_codes: true`.
   - `success_url: ${APP_URL}/app?checkout=success`, `cancel_url: ${APP_URL}/pricing?checkout=cancelled`.
   - `client_reference_id: user_id` (belt-and-braces; webhook already has customer → user via metadata).
4. Return `{ url }`. Client `window.location.assign(url)`.

### Portal — `POST /api/stripe/portal`

1. `requireUser()`.
2. Load profile; 400 if no `stripe_customer_id`.
3. Create Billing Portal Session: `customer`, `return_url: ${APP_URL}/account`, optional `configuration`.
4. Return `{ url }`.

### Webhook — `POST /api/stripe/webhook`

- Runtime: `nodejs` (need raw body for signature verification; App Router gives `request.text()`).
- Verify signature with `STRIPE_WEBHOOK_SECRET` via `stripe.webhooks.constructEvent`.
- Idempotency: upsert by Stripe ids; all handlers are idempotent by construction.
- Handlers:
  - `checkout.session.completed` → fetch expanded subscription → `syncSubscription()` upserts `subscriptions` row by `sub_...` id, resolves `user_id` from Stripe customer's metadata.
  - `customer.subscription.*` → `syncSubscription()`.
  - `invoice.payment_succeeded` → no-op (Stripe sends the receipt). Optionally log to PostHog.
  - `invoice.payment_failed` → `sendEmail(PaymentFailedEmail, { to: profile.email, invoiceUrl })` via Resend; PostHog `payment_failed` event.
  - `charge.refunded` → `sendEmail(RefundIssuedEmail)`; PostHog event.
- Always 200 after processing; return 400 on signature failure, 500 on handler exception (so Stripe retries).

### Refund flow

Refunds are initiated from the **Stripe Dashboard** (or optionally via a small admin-only server action — out of scope for the starter). The webhook handler covers the outbound `charge.refunded` notification email.

---

## 7. Email (Resend + Supabase)

**Supabase's auth emails** (confirm signup, password reset, magic link) are configured in the Supabase dashboard to use **Resend as custom SMTP** (Settings → Auth → SMTP Settings). This keeps Supabase's templating ownership of those flows while delivery goes through your branded domain.

**App-level transactional emails** (sent by our code via `resend.emails.send`):
- `WelcomeEmail` — sent on profile creation (Supabase DB webhook or `handle_new_user` trigger extended with `pg_net`). Simpler: send from the signup server action after successful signup.
- `PaymentFailedEmail` — from webhook.
- `SubscriptionCancelledEmail` — from webhook.
- `RefundIssuedEmail` — from webhook.

**Templates** live in `/emails` as `react-email` components. A Vitest snapshot test ensures each renders. `lib/resend/send.ts` exposes one typed `sendEmail({ template, to, props })` function.

**Password reset link:** Supabase sends it; the email's `{{ .ConfirmationURL }}` points at `${APP_URL}/reset-password?...`. That page calls `supabase.auth.updateUser({ password })`.

---

## 8. Content pipeline (blog + legal)

**Parsing:** `gray-matter` for frontmatter + `remark` + `remark-html` for rendering. (Keep MD-only, not MDX, per prompt.)

**Blog frontmatter schema (Zod-validated):**
```ts
const BlogFrontmatter = z.object({
  title: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string(),
  publishedAt: z.coerce.date(),
  updatedAt: z.coerce.date().optional(),
  author: z.string(),
  tags: z.array(z.string()).default([]),
  coverImage: z.string().optional(),   // e.g. "resources/hello.png"
  draft: z.boolean().default(false),
});
```

**`lib/content/blog.ts` exports:**
- `listPosts()` — reads `content/blog/*.md`, parses + validates, filters out drafts in prod, sorts by `publishedAt desc`, returns `{ frontmatter, excerpt }[]`.
- `getPost(slug)` — returns `{ frontmatter, html }` or `null`.

**Routes:**
- `/blog` — index; `generateMetadata` + JSON-LD.
- `/blog/[slug]` — via `generateStaticParams` from `listPosts()`. `generateMetadata` reads frontmatter. Adds `<link rel="canonical" href="${APP_URL}/blog/${slug}">`, OG tags.

**Blog resources:** served by `app/api/blog/resources/[...path]/route.ts`. The route streams files from `content/blog/resources/` with correct MIME type (via `mime-types`). Path traversal is blocked with `path.resolve` + prefix check. Images in posts are referenced as `/api/blog/resources/hello.png` or (sugar) a remark plugin rewrites `resources/hello.png` → `/api/blog/resources/hello.png` at render time.

**Legal:** `/privacy` and `/terms` read `content/legal/privacy.md` and `terms.md` via the same pipeline; rendered by `components/content/MarkdownRenderer`.

---

## 9. SEO + analytics wiring

**Per-page metadata:** every route exports `generateMetadata()` returning:
- `title`, `description`
- `openGraph` (title, description, url, siteName, images[og-default.png | coverImage])
- `twitter` card
- `alternates.canonical = ${APP_URL}${pathname}`
- `verification.google = GOOGLE_SITE_VERIFICATION` (root layout only)

**`app/sitemap.ts`:** returns array of `{ url, lastModified, changeFrequency, priority }` for `/`, `/pricing`, `/blog`, `/privacy`, `/terms`, and every `/blog/[slug]`.

**`app/robots.ts`:**
```
User-agent: *
Allow: /
Disallow: /app
Disallow: /account
Disallow: /api
Sitemap: ${APP_URL}/sitemap.xml
```

**Google Search Console:** verification meta tag via `metadata.verification.google`. After deploy, user adds property in Search Console and submits `${APP_URL}/sitemap.xml`.

**GA4:** `@next/third-parties/google`'s `<GoogleAnalytics gaId={…}/>` mounted in root layout, only when `NEXT_PUBLIC_GA4_MEASUREMENT_ID` is set.

**PostHog:** provider in `providers.tsx`, initialised with `capture_pageview: false` + an effect that captures `$pageview` on route changes (App Router needs manual pageviews). Identify on login, reset on logout.

---

## 10. Observability

**Sentry:** `@sentry/nextjs` with `next.config.ts` wrapped in `withSentryConfig`. Three config files (`sentry.{client,server,edge}.config.ts`) with `dsn` + `tracesSampleRate: 0.1` + `replaysSessionSampleRate: 0.1`. `SENTRY_AUTH_TOKEN` enables source map upload at build.

**Error boundary:** `app/error.tsx` + `app/global-error.tsx` both call `Sentry.captureException`.

**TanStack Query:** global `onError` reports to Sentry.

---

## 11. Packages

```jsonc
// dependencies (prod)
"next", "react", "react-dom", "typescript",
"@supabase/supabase-js", "@supabase/ssr",
"stripe",
"zod",
"@tanstack/react-query", "@tanstack/react-query-devtools",
"resend", "react-email", "@react-email/components",
"@sentry/nextjs",
"posthog-js", "posthog-node",
"@next/third-parties",
"gray-matter", "remark", "remark-html", "remark-gfm",
"mime-types",
"@iarna/toml"

// dev
"tsx", "vitest", "@vitest/coverage-v8",
"@playwright/test",
"eslint", "eslint-config-next", "prettier",
"@types/node", "@types/react", "@types/mime-types"
```

---

## 12. Step-by-step build order (for the implementing LLM)

Each step should result in a working, committable state.

1. **Init** — `pnpm create next-app` (TS, App Router, no Tailwind, no src alias → we use `src/`). Add the scripts/deps above. Create `.gitignore` entries for `.credentials` and `.env.local`.
2. **Config + secrets** — write `.credentials.example`, `scripts/sync-env.ts`, `src/lib/config.ts`. Verify `pnpm sync:env` fails cleanly on missing keys and succeeds on full `.credentials`.
3. **Supabase clients** — `src/lib/supabase/{browser,server,middleware,admin}.ts` using `@supabase/ssr`. Create Supabase project in dashboard; paste keys.
4. **DB migration** — commit `0001_init.sql`; apply via `supabase db push` (or paste into SQL editor).
5. **Middleware + auth pages** — implement `src/middleware.ts` and the four auth pages + `/api/auth/callback`. Configure Google provider in Supabase dashboard.
6. **Protected app shell** — `(app)/layout.tsx` calls `requireSubscribed()`; `/app/page.tsx` renders welcome + buttons; `/account/page.tsx` renders basic profile + "Manage billing".
7. **Stripe** — create product + prices + portal + webhook in Stripe dashboard; implement `/api/stripe/{checkout,portal,webhook}/route.ts`; implement `lib/stripe/sync-subscription.ts`. Confirm `stripe trigger` fires update the `subscriptions` table.
8. **Marketing pages** — landing, pricing (reads price ids from config, posts to `/api/stripe/checkout`), footer w/ links to blog/privacy/terms.
9. **Content pipeline** — blog index + slug route + resources route + `privacy`/`terms`. Seed one example post.
10. **SEO plumbing** — `generateMetadata` on every page, `sitemap.ts`, `robots.ts`, verification meta.
11. **Analytics + observability** — Sentry init, PostHog provider, GA4 mount. Verify events fire.
12. **Emails** — Resend templates + `sendEmail`. Configure Supabase SMTP in dashboard.
13. **Tests** — unit + e2e + webhook harness per §13.
14. **Deploy** — push to GitHub; import into Vercel; run `pnpm sync:env:prod` to push vars; point custom domain; run Vercel deploy; add webhook URL in Stripe live mode; submit sitemap to Search Console.

---

## 13. Testing & verification plan

### Unit (Vitest)

- `config.test.ts` — Zod config schema rejects missing keys, accepts full `.credentials.example` shape.
- `blog.test.ts` — `listPosts` returns posts in descending date order; rejects malformed frontmatter; excludes drafts in production; `getPost('missing')` is null.
- `stripe-sync.test.ts` — given a fixture Stripe subscription object, `syncSubscription` upserts the correct row; second call is idempotent; cancellation fields are cleared on reactivation.
- `emails.test.tsx` — snapshot each react-email template.

### E2E (Playwright) — run against `pnpm dev` with a test Supabase project and `stripe listen` in background

`tests/e2e/marketing.spec.ts`
- `/` renders landing and is indexable (has `<title>`, canonical, no `noindex`).
- `/pricing`, `/blog`, `/blog/hello-world`, `/privacy`, `/terms` return 200.
- `/sitemap.xml` lists every public URL. `/robots.txt` disallows `/app`.

`tests/e2e/auth.spec.ts`
- Signup with unique email → confirmation email logged (Resend test mode) → login → lands on `/pricing` (no sub yet).
- Forgot password → email link → reset → new password logs in.
- Google OAuth button present and links to Supabase OAuth endpoint (not clicked in CI).

`tests/e2e/checkout.spec.ts`
- Logged-in unsubscribed user clicks "Subscribe monthly" → redirected to Stripe Checkout (URL host is `checkout.stripe.com`).
- Using Stripe's test card via Playwright in Stripe-hosted page → success → returns to `/app`.
- After webhook syncs, `/app` shows the dashboard; `/pricing` now redirects to `/app`.
- Clicking "Manage billing" reaches `billing.stripe.com`.
- Simulating cancellation (`stripe trigger customer.subscription.deleted`) updates DB → next visit to `/app` redirects back to `/pricing`.

### Stripe webhook harness (`scripts/stripe-test.ts`)

Spawns `stripe listen --forward-to localhost:3000/api/stripe/webhook` and then, for each of the subscribed events, runs `stripe trigger <event>` against a seeded test customer/subscription. Asserts the `subscriptions` row reaches the expected state after each. This is the fastest way to prove the webhook handler without browser automation.

### Manual smoke checklist (post-deploy)

Run through once on prod with **live** Stripe + a real email:

- [ ] `pnpm sync:env` succeeds with filled `.credentials`.
- [ ] Dev build: `pnpm dev`, no runtime errors.
- [ ] Prod build: `pnpm build && pnpm start`, no warnings about missing env.
- [ ] Visit `/` anon → landing loads, GA4/PostHog events fire (check dashboards).
- [ ] Sign up with real email → confirmation email arrives from Resend-powered Supabase SMTP.
- [ ] Post-confirm, `/` redirects to `/pricing`.
- [ ] Subscribe monthly with live card → Stripe receipt email arrives (Stripe-native) → redirected to `/app`.
- [ ] `/app` shows welcome. `/pricing` now redirects to `/app`.
- [ ] "Manage billing" → Stripe Portal loads → cancel subscription → email from our handler arrives → `/app` redirects back to `/pricing` on next load.
- [ ] Trigger a payment failure in Stripe test → PaymentFailedEmail arrives.
- [ ] Sentry dashboard shows a test error thrown from `/api/health?throw=1`.
- [ ] PostHog shows `$pageview` + `signed_up` events.
- [ ] `sitemap.xml` / `robots.txt` correct. Search Console verifies property.
- [ ] Lighthouse score on `/`, `/pricing` is ≥ 90 across the board.

When every checkbox is green, the starter is "wired" and ready to clone.

---

## 14. Non-goals / explicit out-of-scope

- CSS/styling (prompt defers this).
- Teams/organizations, invites, roles.
- Multi-tier pricing, feature gating beyond subscribed/not-subscribed.
- Admin dashboards, user impersonation, refund UI.
- i18n, dark/light theming.
- GitHub Actions CI (by user choice).
- MFA/TOTP (not requested; can be added via Supabase later).
