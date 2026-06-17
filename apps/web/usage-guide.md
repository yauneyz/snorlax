# Usage Guide

## What This Repo Is

This repo is a production-shaped SaaS starter built on Next.js App Router. It gives you:

- public marketing pages
- auth with Supabase
- subscription billing with Stripe
- transactional email with Resend
- analytics with PostHog and GA4
- error monitoring with Sentry
- markdown-driven blog and legal pages

The intended workflow is:

1. Fill out `.credentials`.
2. Generate `.env.local`.
3. Point the app at Supabase + Stripe.
4. Replace the placeholder dashboard with your product.
5. Keep using the starter's auth, billing, content, and observability plumbing.

The repo is deliberately light on product logic and styling. The business-specific part is what you add under the gated app surface.

## Mental Model

The main moving pieces are:

- `.credentials` is the source of truth for secrets and per-app settings.
- `scripts/sync-env.ts` turns `.credentials` into the env vars Next.js and the SDKs expect.
- `src/lib/config.ts` validates those env vars once and exports a typed config object.
- `src/app` contains three route groups:
  - `(marketing)` for public pages
  - `(auth)` for login/signup/password reset
  - `(app)` for the paid product area
- `src/middleware.ts` decides where a user should land based on auth + subscription state.
- Supabase is the source of truth for identity and app data.
- Stripe is the source of truth for billing. The app mirrors Stripe subscription state into Postgres for fast entitlement checks.

If you understand those seven points, the rest of the repo follows pretty naturally.

## Repository Layout

This is the important layout, not every file:

```text
.
|- .credentials.example        # template for secrets and app-level settings
|- scripts/
|  |- sync-env.ts             # .credentials -> .env.local or Vercel env push
|  |- stripe-test.ts          # local Stripe webhook harness
|- supabase/
|  |- config.toml             # local Supabase CLI config
|  |- migrations/0001_init.sql
|  |- seed.sql
|- content/
|  |- blog/                   # markdown posts + post assets
|  |- legal/                  # privacy.md and terms.md
|- emails/                    # React Email templates
|- src/
|  |- app/                    # App Router pages, layouts, route handlers
|  |- components/             # UI grouped by surface
|  |- lib/                    # framework/service adapters and shared helpers
|  |- instrumentation.ts      # Sentry bootstrap
|  |- middleware.ts           # auth/subscription routing
|- tests/
|  |- unit/
|  |- e2e/
```

The repo is a single Next.js app. There is no separate frontend package, backend package, or worker package. The "backend" is the combination of:

- App Router route handlers in `src/app/api/**`
- server components and server-only helpers in `src/lib/**`
- Supabase Postgres + auth
- Stripe webhooks

## How It Is Laid Out

### `src/app`

This is organized by route group, which gives each surface its own layout without changing the URL.

- `(marketing)`
  - `/`
  - `/pricing`
  - `/blog`
  - `/privacy`
  - `/terms`
- `(auth)`
  - `/login`
  - `/signup`
  - `/forgot-password`
  - `/reset-password`
- `(app)`
  - `/app`
  - `/account`

There are also API routes under `src/app/api/**` for:

- health checks
- Supabase OAuth callback
- Stripe checkout session creation
- Stripe billing portal session creation
- Stripe webhook handling
- blog resource streaming

### `src/components`

Components are grouped by the same surfaces:

- `marketing/`
- `auth/`
- `app/`
- `content/`

That keeps the public site, auth UX, and paid app from bleeding into each other.

### `src/lib`

This is where the actual architecture lives.

- `config.ts`
  - centralizes runtime config
- `supabase/`
  - browser, server, middleware, and admin clients
- `stripe/`
  - checkout, portal, and webhook sync logic
- `auth/`
  - server-side guards like `requireUser()` and `requireSubscribed()`
- `content/`
  - markdown loaders for blog and legal pages
- `resend/`
  - email delivery helper
- `analytics/`
  - PostHog helpers
- `zod/`
  - request and content schemas

The rule of thumb is:

- page/layout/route files orchestrate requests
- `src/lib/**` holds service integration and reusable server logic

## The Runtime Flow

### 1. Startup Flow

When you run `pnpm dev` or `pnpm build`:

1. `predev` and `prebuild` run `pnpm sync:env`.
2. `scripts/sync-env.ts` reads `.credentials` and writes `.env.local`.
3. `src/lib/config.ts` validates env at import time with Zod.
4. `src/app/layout.tsx` builds app-wide metadata and wraps the app in `Providers`.
5. `src/app/providers.tsx` wires up:
   - React Query
   - PostHog page tracking
   - Supabase auth state sync
   - GA4 injection from the root layout

Important convention: modules should import `config` instead of reading `process.env` directly.

### 2. Request Routing Flow

Every non-asset, non-API request passes through `src/middleware.ts`.

Two important exceptions are intentionally excluded from the middleware matcher:

- `/api/auth/callback`, so Supabase can establish the session first
- `/api/stripe/webhook`, because Stripe signature verification needs the raw request body

The middleware classifies the request as one of:

- marketing
- auth
- app
- api
- asset

Then it does this:

- app routes:
  - anonymous users get redirected to `/login`
  - logged-in users without an active subscription get redirected to `/pricing`
  - subscribed users continue
- auth routes:
  - logged-in users get redirected to `/app`
- marketing routes:
  - `/` redirects logged-in users to `/pricing` or `/app`
  - the rest of marketing stays publicly browsable
- API routes:
  - pass through, because handlers do their own auth

There is a second layer of protection inside the app surface:

- `requireUser()` checks auth server-side
- `requireSubscribed()` checks auth + entitlement server-side

So the real rule is not "middleware protects the app". The real rule is "middleware improves UX, server guards enforce access".

### 3. Auth Flow

The auth flow uses Supabase throughout.

Email/password flow:

1. User visits `/login` or `/signup`.
2. Client components validate input with Zod.
3. `supabaseBrowser()` calls Supabase auth methods in the browser.
4. Supabase issues session cookies.
5. Middleware and server helpers see the session on future requests.

Google OAuth flow:

1. `OAuthButtons.tsx` calls `signInWithOAuth({ provider: "google" })`.
2. The redirect target is `/api/auth/callback`.
3. `src/app/api/auth/callback/route.ts` exchanges the code for a session.
4. The user is redirected to `/app` or the requested `next` URL.

Password reset flow:

1. `/forgot-password` calls `resetPasswordForEmail()`.
2. The email links back to `/reset-password`.
3. The reset page calls `updateUser({ password })`.

Database side:

- `supabase/migrations/0001_init.sql` creates `profiles`.
- a trigger on `auth.users` creates the matching `profiles` row automatically.

Important caveat:

- The starter UX assumes signup can land the user in the app immediately.
- If you enable mandatory email confirmation in Supabase, you will likely want to change the signup screen and post-signup redirect behavior.

### 4. Billing Flow

Billing uses Stripe as the billing system and Supabase as the entitlement cache.

The flow is:

1. The user clicks subscribe on `/pricing`.
2. `PricingCard.tsx` checks whether there is a session.
3. Authenticated users post to `/api/stripe/checkout`.
4. That route calls `createCheckoutSession()` in `src/lib/stripe/checkout.ts`.
5. The helper:
   - looks up the user's `profiles` row
   - creates a Stripe customer if needed
   - stores `stripe_customer_id` on the profile
   - creates a Stripe Checkout Session for the monthly or yearly price
6. Stripe hosts checkout.
7. Stripe sends webhook events to `/api/stripe/webhook`.
8. The webhook verifies the signature, reloads the subscription from Stripe, and calls `syncSubscription()`.
9. `syncSubscription()` upserts a row into `public.subscriptions`.
10. The `active_subscriptions` view exposes active or trialing subscriptions.
11. Middleware and `requireSubscribed()` use that view to decide entitlement.

The webhook route explicitly runs on the Node runtime because Stripe signature verification depends on the raw body.

Billing portal flow:

1. The user clicks "Manage billing".
2. The app posts to `/api/stripe/portal`.
3. `createPortalSession()` creates a Stripe billing portal session.
4. Stripe sends the user back to `/account` afterward.

Email side effects from webhooks:

- `invoice.payment_failed` -> payment failed email
- `customer.subscription.deleted` -> cancellation email
- `charge.refunded` -> refund email

Important caveat:

- The `WelcomeEmail` template exists, but there is no runtime code that sends it on signup today.

### 5. Content Flow

Blog content is file-based.

Posts live in `content/blog/*.md` and use frontmatter validated by `src/lib/zod/blog-frontmatter.ts`.

The blog pipeline is:

1. `src/lib/content/blog.ts` reads markdown files from disk.
2. Frontmatter is parsed with `gray-matter`.
3. Zod validates the frontmatter.
4. `remark` converts markdown to HTML.
5. image URLs like `resources/foo.png` are rewritten to `/api/blog/resources/foo.png`.
6. the route handler under `src/app/api/blog/resources/[...path]/route.ts` serves those files safely.

Legal docs work similarly:

- `content/legal/privacy.md`
- `content/legal/terms.md`
- `src/lib/content/legal.ts` renders them to HTML

The blog and legal content is treated as trusted, repo-authored content. `MarkdownRenderer` uses `dangerouslySetInnerHTML` on purpose.

### 6. SEO, Analytics, and Observability Flow

Marketing pages are set up to be indexable.

- root metadata comes from `src/app/layout.tsx`
- per-page metadata is defined in page files
- `src/app/sitemap.ts` builds sitemap entries from static pages and blog posts
- `src/app/robots.ts` disallows `/app`, `/account`, and `/api`
- GA4 is injected when `NEXT_PUBLIC_GA4_MEASUREMENT_ID` is set
- PostHog page views are captured manually in `Providers`
- Sentry initializes in client, edge, and node runtimes

The repo also includes:

- `src/app/error.tsx`
- `src/app/global-error.tsx`
- `/api/health`

`/api/health?throw=1` is a simple Sentry smoke test.

## How To Run The Starter

### 1. Install dependencies

```bash
pnpm install
```

### 2. Create app credentials

Copy `.credentials.example` to `.credentials` and fill in:

- app name and URL
- Supabase keys
- Stripe keys and price IDs
- Resend sender
- LLM provider settings (`openai` or local `vllmserve`)
- optional Sentry, PostHog, and Google values

### 3. Generate env vars

```bash
pnpm sync:env
```

You normally do not need to run this manually because `pnpm dev` and `pnpm build` already run it first.

### 4. Set up Supabase

You can use either a hosted Supabase project or the local CLI stack.

If you want local Supabase, this repo already has `supabase/config.toml`. The intended local flow is:

```bash
supabase start
supabase db reset
```

That applies `supabase/migrations/*` and `supabase/seed.sql`.

You also need to align Supabase auth settings with this app:

- site URL should match your app URL
- Google OAuth redirect should end at `/api/auth/callback`
- if you enable email confirmations, adjust signup UX accordingly

### 5. Set up Stripe

Create:

- one monthly recurring price
- one yearly recurring price
- an optional billing portal configuration

Put their IDs in `.credentials`.

The app expects:

- test and live API keys
- test and live webhook secrets
- monthly and yearly price IDs

### 6. Choose an LLM Provider

Set `[llm].provider` in `.credentials`:

- `openai` uses `[openai].api_key`, `[openai].default_model`, and optional `[openai].base_url`
- `local` uses the `vllmserve` OpenAI-compatible endpoint in `[local_llm]`

The local defaults match the desktop `vllmserve` wrapper:

```toml
[llm]
provider = "local"

[local_llm]
endpoint = "http://127.0.0.1:11434/v1/chat/completions"
model = "qwen3-14b-awq"
```

### 7. Start the app

```bash
pnpm dev
```

### 8. Useful local tools

```bash
pnpm test
pnpm test:e2e
pnpm test:e2e:live
pnpm stripe:test
pnpm email:dev
```

Notes:

- `pnpm stripe:test` expects Stripe CLI to be installed and a local dev server running.
- `pnpm test:e2e` uses Playwright and can run against the local server or an external base URL.
- the checkout E2E test expects `E2E_USER_EMAIL` and `E2E_USER_PASSWORD`.
- `pnpm test:e2e:live` creates a confirmed Supabase test user, logs in through the UI, completes Stripe Checkout with a test card, waits for webhook sync, asserts the Supabase subscription row, and then cleans up the user/customer. It requires Stripe test-mode credentials and a working webhook path. For local runs, start `stripe listen --forward-to http://localhost:3000/api/stripe/webhook` and put that listener's `whsec_...` in `.credentials`; for deployed runs, set `E2E_BASE_URL` to the deployed app URL and use the deployed webhook secret.
- `pnpm email:dev` previews the React Email templates in `emails/`.

## How To Build A New App With It

The right way to use this starter is not to rewrite the plumbing. Keep the plumbing and replace the placeholder product surface.

### Step 1: Rebrand and replace starter copy

Start with:

- `.credentials`
- `src/app/layout.tsx`
- `src/app/(marketing)/page.tsx`
- `src/app/(marketing)/pricing/page.tsx`
- `content/legal/*.md`
- `content/blog/*.md`
- `emails/*.tsx`

That gets your app name, URLs, legal docs, marketing copy, and outgoing email voice into shape.

### Step 2: Build your data model

Add your own tables in a new Supabase migration.

Keep these tables and concepts:

- `profiles`
- `subscriptions`
- `active_subscriptions`

Then update:

- `src/lib/supabase/types.ts`
- `src/lib/supabase/database.types.ts`

If the schema grows significantly, regenerate `database.types.ts` from Supabase instead of hand-editing it.

### Step 3: Replace the placeholder app

The current paid app is only:

- `/app` -> placeholder dashboard
- `/account` -> account summary + billing portal link

That is where your real product goes.

Typical additions:

- add new routes under `src/app/(app)/...`
- add product components under `src/components/app/...`
- add server helpers under `src/lib/...`
- add API routes under `src/app/api/...` when you need backend entry points

Use:

- `requireUser()` for features that only need auth
- `requireSubscribed()` for features that require an active paid subscription

### Step 4: Keep entitlement checks simple

Do not re-derive billing state all over the codebase.

This repo already has a clean pattern:

- Stripe owns billing state
- webhook sync writes a normalized subscription row
- app code checks `active_subscriptions`

If you add more plans, seats, or feature flags, extend that projection rather than spreading raw Stripe logic across pages.

### Step 5: Extend checkout only when your product needs it

Right now checkout is intentionally simple:

- two plans
- one subscription quantity
- one customer per user

If your app needs more, the extension points are:

- `src/lib/zod/checkout.ts`
- `src/components/marketing/PricingCard.tsx`
- `src/lib/stripe/checkout.ts`
- `src/lib/auth/require-subscribed.ts`
- the `subscriptions` schema and any derived views

### Step 6: Add product-side backend logic in the existing pattern

For server work:

- use route handlers for HTTP entry points
- use server components for page-level data loading
- keep service adapters in `src/lib/**`
- use `supabaseAdmin()` only from server-only code

There is already an ESLint rule blocking accidental client imports of the secret-key Supabase client.

### Step 7: Style it last

`src/app/globals.css` is intentionally almost empty.

The starter already gives you semantic class names. The intended move is:

1. keep the structure
2. design your brand system
3. fill in CSS once the product surface is real

## Practical Conventions

- Treat `.credentials` as the single editable config file.
- Treat `.env.local` as generated output.
- Import `config` instead of reading env ad hoc.
- Use `createLlmClient()` from `src/lib/llm/client.ts` for server-side LLM completions.
- Use the right Supabase client for the environment:
  - browser client in client components
  - server client in RSC and route handlers
  - middleware client in `src/middleware.ts`
  - admin client only in server-only code
- Keep billing writes inside webhook and Stripe helpers.
- Keep markdown content inside `content/`.
- Put public assets referenced from blog markdown under `content/blog/resources/`.

## Current Gaps You Should Know About

These are not architectural problems, but they matter when you build on top of the starter:

- `WelcomeEmail` exists but is not sent anywhere yet.
- `src/lib/analytics/posthog-server.ts` exists but is not currently used by a request path.
- the app shell is only a placeholder dashboard, not a product framework beyond auth and billing
- the signup flow assumes a session is available immediately after registration

## Short Version

If you want to build a new SaaS app with this repo, do it in this order:

1. Fill in `.credentials`.
2. Bring up Supabase and Stripe.
3. Run `pnpm dev`.
4. Replace marketing copy and legal docs.
5. Add your schema migrations.
6. Build your real pages under `src/app/(app)`.
7. Keep using the existing auth, billing, and content flow instead of inventing a second one.

That is the intended flow of the repo.
