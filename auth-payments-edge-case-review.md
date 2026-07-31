# Auth and Payments Edge-Case Review

Reviewed 2026-07-31 against the working tree based on commit `6536df5` (including
pre-existing uncommitted work).

Resolution update, 2026-07-31: findings 5, 7, 8, and 10 were fixed. Their original
numbering is retained so follow-up discussion can continue to refer to the summary table.

## Scope and method

This was a static review of the web, desktop, Supabase, and Stripe state transitions:

- email/password and Google authentication;
- signup confirmation and password recovery;
- web cookie auth and desktop bearer auth;
- Checkout, success returns, webhook projection, portal, cancellation, and resume;
- paid, complimentary, cached/offline, and free entitlements;
- the conditions that show account, checkout, billing, and redemption controls.

Unresolved findings below describe reachable states from the current code; resolved
sections retain the original scenario followed by its implemented resolution. They do not
assume a Stripe or Supabase misconfiguration unless the finding explicitly says so.

Focused suites passed after the resolution update:

- monorepo unit tests: 104/104;
- web unit tests: 80/80.

Those suites validate the intended components in isolation. They do not currently cover
the cross-account cache sequence, confirmation-required web signup, duplicate-checkout
eligibility, or the combined entitlement/billing UI states described below.

## Summary

The main happy paths are thoughtfully defended. In particular, webhook writes are
idempotent, the web checkout success path verifies that the Checkout Session belongs to
the signed-in user, Stripe-customer creation handles concurrent requests, and clean
complimentary accounts do not get a broken billing-portal button.

I found three high-priority edge cases and several medium/low-priority UX inconsistencies:

| Priority | Finding                                                                         | Main effect                                                                                   |
| -------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| High     | Web signup does not handle confirmation-required results                        | Production email signup can loop back to signup/pricing without telling the user to confirm   |
| High     | Checkout has no server-side "already subscribed" guard                          | Active, past-due, or complimentary users can create overlapping subscriptions                 |
| High     | Desktop offline entitlement cache is not scoped to a user                       | A second signed-in account can inherit the previous account's cached Pro access while offline |
| Medium   | Signed-in users cannot consume the hosted recovery link                         | Reset email can redirect an already signed-in browser away before token verification          |
| Resolved | Web billing reads collapse errors and non-active statuses into "not subscribed" | Web and desktop now share a bounded one-month verification-grace policy                       |
| Medium   | Desktop shows Manage billing for free users and while detail is loading         | The button either errors or opens an empty portal                                             |
| Resolved | Paid users can redeem a complimentary code without billing changing             | Redemption now immediately cancels any current paid subscription                              |
| Resolved | Web account copy does not represent cancellation or price cleanly               | Typed plan/cancellation copy is used and unknown price IDs remain unknown                      |
| Low      | Signed-in marketing header still shows Get started                              | It redirects through signup and commonly lands back where the user started                    |
| Resolved | Free-plan allowance differs between pricing and enforcement                     | One shared product constant now sets all surfaces to 3 blocked sites                           |

## Findings

### 1. High — production web signup does not handle email confirmation

**Scenario**

1. Production has `enable_confirmations = true`.
2. A visitor clicks a paid plan, is sent to
   `/signup?next=/pricing?plan=monthly`, and creates an email/password account.
3. Supabase returns a user but no session until the email is confirmed.
4. The form treats any response without an error as a completed sign-up and pushes the
   visitor to the `next` URL.
5. They arrive back at pricing while still signed out. Clicking Subscribe sends them to
   signup again. There is no "check your email" state on the web.

The same response handling also misses Supabase's obfuscated existing-account result. The
desktop explicitly classifies `signedIn`, `confirmEmail`, and `alreadyRegistered`; the web
does not.

**Evidence**

- Production confirmation is enabled in
  `apps/web/supabase/config.toml:81-84`.
- `apps/web/src/components/auth/SignupForm.tsx:29-42` discards `data.user` and
  `data.session` and always navigates after a non-error response.
- The selected plan path is constructed in
  `apps/web/src/components/marketing/PricingCard.tsx:27-30`.
- The desktop has the missing result classification in
  `apps/desktop/src/main/auth/signUpResult.ts` and a check-email view in
  `apps/desktop/src/renderer/pages/Account.tsx`.

**Recommendation**

Give web signup the same response classification as desktop. When there is no session,
show a durable "check your email" state and preserve the intended post-confirmation
destination. Treat `identities: []` as an existing-account result.

### 2. High — Checkout can create overlapping subscriptions

There are two ways to reach this.

**Clean active or complimentary account**

The web pricing page always renders active Subscribe buttons, even for a signed-in Pro
user. The Checkout API and shared `createCheckoutSession` function do not check for an
existing paid subscription or grant before creating another subscription-mode Checkout
Session.

**Past-due, paused, unpaid, or incomplete account**

The entitlement views count only `trialing` and `active` as Pro. A past-due user therefore
looks free to the plan gate even though the billing-detail code considers `past_due` a
current subscription. On desktop this produces "Free" plus "Payment issue" on Account,
while Plans enables both Upgrade buttons. On the web, Account does not query past-due
subscriptions at all and offers "Choose a plan."

Completing either checkout can leave multiple subscriptions on the same Stripe customer.
Subsequent account reads use `limit(1)`, so which subscription the user sees or cancels
can then differ by surface.

**Evidence**

- Unconditional Subscribe UI:
  `apps/web/src/components/marketing/PricingCard.tsx:18-58`.
- Checkout creates a subscription without a current-subscription check:
  `packages/billing-server/src/index.ts:82-145`.
- The active view excludes every status except `trialing` and `active`:
  `apps/web/supabase/migrations/0001_init.sql:41-46`.
- Desktop display includes `past_due`:
  `packages/billing-server/src/index.ts:274-327`.
- Desktop upgrade buttons gate only on the entitlement plan:
  `apps/desktop/src/renderer/pages/Plans.tsx:72-91`.
- Web Account reads only `active_subscriptions` and otherwise shows Choose a plan:
  `apps/web/src/app/(app)/account/page.tsx:16-33,63-68`.

**Recommendation**

Enforce a server-side checkout policy, not only a UI policy. Before creating Checkout,
load all current/recoverable billing states and return a typed response such as
`manage_existing_subscription`, `already_pro`, or `checkout_allowed`. Make the web and
desktop buttons use that same projection. Decide explicitly whether a complimentary user
may replace a grant with paid access; do not expose ordinary Subscribe controls by
default.

### 3. High — desktop offline entitlement cache can cross account boundaries

**Scenario**

1. User A signs in and receives a server-verified Pro entitlement.
2. It is written to the single file `entitlement-cache.json`.
3. User A signs out. The auth store is cleared, but the entitlement cache is not.
4. User B signs in while the entitlement endpoint is unreachable.
5. Because User B has an access token, the request is attempted; on network failure the
   code reads the same cache file and can return User A's Pro entitlement for up to 30
   days.

The cached `Entitlement` schema carries no user id, so the reader cannot verify ownership.
This is an authorization-state leak on shared OS accounts, not merely stale display copy.

**Evidence**

- The fixed cache filename and unscoped read/write:
  `apps/desktop/src/main/auth/subscription.ts:84-105`.
- Any signed-in token followed by a fetch failure falls back to that cache:
  `apps/desktop/src/main/auth/subscription.ts:154-175`.
- The offline lease is valid for 30 days:
  `apps/desktop/src/main/auth/offlineEntitlement.ts:3-27`.
- Desktop signout clears only the Supabase session:
  `apps/desktop/src/main/auth/supabase.ts:239-248`.

**Recommendation**

Bind cached entitlements to the Supabase user id and reject a mismatched cache. Either
store per-user cache files or add a required `userId` envelope around the entitlement.
Clear the active user's cache on signout as defense in depth.

### 4. Medium — an already signed-in browser cannot use the hosted recovery link

The production recovery template links to `/auth/recovery?token_hash=...`. Middleware
classifies `/auth/recovery` as an auth route and redirects every signed-in user away from
auth routes except `/reset-password`. Therefore, a user who opens the reset email in a
browser that already has any valid session is sent to `/app` before the recovery
confirmation page can POST and verify the token.

The root-level `?code` exception in middleware does not help this template: the committed
template uses `/auth/recovery` and `token_hash`.

Separately, `/reset-password` is deliberately public and always renders the Save button.
For an anonymous direct visitor it produces a real-looking password form that explains
the missing session only after `updateUser` fails. For an ordinary signed-in visitor, it
can act as an unlabelled account password-change form even though no recovery link was
followed.

**Evidence**

- Recovery-email target:
  `apps/web/supabase/templates/recovery.html:1-9`.
- `/auth/recovery` is an auth path, but only `/reset-password` is exempt from signed-in
  redirect: `apps/web/src/lib/auth/route-classification.ts:3-18` and
  `apps/web/src/middleware.ts:45-49`.
- The reset form calls `updateUser` without first establishing that the current session is
  a recovery session: `apps/web/src/components/auth/ResetPasswordForm.tsx:14-31`.

**Recommendation**

Allow the token-confirmation route through even when a normal session cookie exists. On
the password form, carry explicit server-verified recovery state (or show an invalid-link
state) rather than treating every visitor as ready to reset.

### 5. Resolved — billing uncertainty receives a bounded verification grace

The original implementation discarded errors from several web reads:

- middleware initializes `subscribed = false` and uses only `data`;
- `requireSubscribed` uses only `rows`;
- Account ignores errors from profile, subscription, and grant queries.

A transient database/RLS failure consequently redirects a paying user to pricing or
renders "Not subscribed" and "Choose a plan." Combined with finding 2, an outage can
invite a duplicate purchase.

Non-active Stripe states have the same UX even without an outage because web Account
queries `active_subscriptions`, not the broader billing-detail projection. This removes
the billing portal exactly when a past-due user needs to repair a payment method. A user
with both a complimentary grant and a past-due paid subscription is shown only as
complimentary and gets no portal control on the web.

**Evidence**

- Error is ignored and an empty result means unsubscribed:
  `apps/web/src/middleware.ts:17-24,41`.
- The server-component guard has the same behavior:
  `apps/web/src/lib/auth/require-subscribed.ts:17-25`.
- Account ignores all three query errors and reads only active subscriptions:
  `apps/web/src/app/(app)/account/page.tsx:16-33`.

**Resolution**

- The one-month verification period is now a shared product policy used by desktop
  offline access and web billing uncertainty.
- Recoverable billing states (`past_due`, `unpaid`, `paused`, `incomplete`, and stale
  `active`/`trialing` projections) retain Pro for at most one month from their last
  billing update. Repeated reads do not restart that period.
- Web reads use a signed, user-scoped verification cookie during database outages. A
  confirmed free or terminal subscription state clears it.
- Account uses the broader typed billing-detail projection. Read failures show
  verification pending without exposing an upgrade CTA, and payment-problem states keep
  the billing portal available.

### 6. Medium — desktop shows Manage billing when there is nothing to manage

For every signed-in desktop user, Manage billing is shown unless
`detail?.status === "comped"`. That condition is true while subscription detail is still
`undefined`, after a transient detail-load failure, and for a confirmed free account
whose detail is `{hasSubscription:false, plan:"free"}`.

- A user who has never opened Checkout receives "No billing account yet - subscribe
  first."
- A user who abandoned Checkout may have a Stripe customer and get an empty portal.
- Keeping the last detail snapshot on failures can also show controls for stale state.

**Evidence**

- Visibility condition:
  `apps/desktop/src/renderer/pages/Account.tsx:257-269`.
- The no-customer error is expected by the billing service:
  `packages/billing-server/src/index.ts:53-57`.
- Subscription detail intentionally keeps the previous snapshot on transient failures:
  `apps/desktop/src/renderer/store/useFocusStore.ts`.

**Recommendation**

Show Manage billing only when detail has loaded and either `hasSubscription` is true or
the server explicitly reports a manageable Stripe customer. Show a neutral loading/error
state while detail is unknown.

### 7. Resolved — complimentary redemption stops paid renewal

Desktop shows Redeem a code to every signed-in user, including an active paid Pro user.
The redemption function checks only for an existing active grant, not for a paid
subscription. A paid user can therefore consume a single-use code, receive a hidden
lifetime grant, and continue being billed. The success copy is only "You're on Pro.
Enjoy!", which does not explain that billing is unchanged.

The inverse is also possible: a complimentary user can click Subscribe on web pricing
and start paying while retaining the grant. The paid subscription then takes precedence
in display; canceling it later reveals the grant again.

This may be a valid business policy, but the current controls and copy do not communicate
it.

**Evidence**

- Desktop always exposes the redemption link to signed-in users:
  `apps/desktop/src/renderer/pages/Account.tsx:300-330`.
- SQL's `already_comped` test looks only at `entitlement_grants`, then burns the code:
  `apps/web/supabase/migrations/0004_comp_grants.sql:115-142`.
- The entitlement reader deliberately prefers a paid subscription when both exist:
  `packages/billing-server/src/index.ts:236-253`.

**Resolution**

After a valid code is redeemed, any current paid subscription is canceled immediately;
the complimentary grant replaces its access. The response explicitly tells the user
that the paid subscription was canceled. If Stripe cancellation fails after the
transactional code redemption, retrying redemption also retries the cancellation because
`already_comped` follows the same billing transition.

### 8. Resolved — account surfaces preserve billing state and unknown prices

For an active subscription, the Plan field displays the raw Stripe `price_id`, not
"Monthly" or "Annual." It always labels `current_period_end` as "Renews," even when
`cancel_at_period_end` is true and the correct label is "Cancels." This makes the web
surface disagree with desktop, which handles both fields.

If price IDs change, the shared desktop billing projection has a related issue: every
unknown price id is silently classified as monthly.

**Evidence**

- Raw price and unconditional renewal label:
  `apps/web/src/app/(app)/account/page.tsx:43-55`.
- Unknown-price fallback:
  `packages/billing-server/src/index.ts:319-326`.

**Resolution**

Web Account now renders from the typed subscription-detail projection, maps known price
IDs to monthly/annual copy, and uses `cancelAtPeriodEnd` to choose Renew/Cancel. Unknown
price IDs remain absent from the projection instead of silently becoming monthly; web
and desktop show neutral "billing plan unavailable" copy.

### 9. Low — signed-in marketing navigation still shows Get started

The header correctly swaps Log in for an Account menu when signed in, but Get started is
always linked to `/signup`. Middleware then redirects a signed-in user from signup to
`/app`; a free user is immediately redirected again to `/pricing`. On pricing this feels
like a button that reloads the user's current page through two unrelated routes.

**Evidence**

- Unconditional CTA:
  `apps/web/src/components/marketing/Header.tsx:19-31`.
- Signed-in auth-route redirect:
  `apps/web/src/middleware.ts:45-49`.

**Recommendation**

Make the CTA session-aware: Dashboard for entitled users, Choose a plan or Download for
free users, and no redundant CTA when already on its destination.

### 10. Resolved — free-plan copy and enforcement share one limit

Originally, web pricing promised "3 websites blocked," while desktop Plans and the product
limit enforced 5. This could make a free user believe they received an unexplained upgrade
or make pricing look stale.

**Evidence**

- Web pricing: `apps/web/src/app/(marketing)/pricing/page.tsx:17-24`.
- Product enforcement: `packages/product/src/index.ts:71-80`.
- Desktop Plans: `apps/desktop/src/renderer/pages/Plans.tsx:46-56`.

**Resolution**

`FREE_BLOCKED_SITE_LIMIT` is exported from the shared product package with the value
`3`. Product enforcement plus web and desktop plan copy all consume that constant.

## Lower-confidence edge worth a targeted test

Desktop's `passwordRecoveryPending` flag is in memory, while the recovery session itself
is persisted. If the app is restarted after exchanging a desktop recovery link but before
submitting a new password, the restored session may appear as an ordinary signed-in
session because startup emits an initial-session event rather than the explicit
`recovery` option that sets the flag. The code comment guarantees cold-start link
handling, which is covered; restart _after exchange_ is a different sequence.

Relevant code:
`apps/desktop/src/main/auth/supabase.ts:29-34,47-61,223-235`.

## Defenses that appear sound

- Server-side auth uses `getUser`, not cookie/session payload trust, and desktop endpoints
  validate bearer tokens with Supabase.
- Internal auth redirects reject cross-origin, protocol-relative, and backslash-normalized
  targets.
- Web checkout success verifies `client_reference_id === user.id` before fast-path sync.
- Stripe customer creation uses a compare-and-set update and deletes the losing duplicate
  customer after concurrent requests.
- Webhook signatures are verified against the raw body; successful events are deduplicated.
- Subscription events retrieve current Stripe state before upsert, reducing out-of-order
  event regressions.
- Subscription cancel/resume updates Stripe and synchronously projects the returned state
  before waiting for the webhook.
- Entitlement reads deliberately prefer paid state when paid and complimentary access
  coexist.
- Clean complimentary-only accounts hide billing controls on both web and desktop.
- Complimentary code redemption is transactional and row-locked, so concurrent use cannot
  exceed the redemption count.
- Desktop checkout buttons are disabled until auth and entitlement have loaded, and
  cancellation requires an explicit second click.

## Suggested fix order

1. Scope the desktop offline cache to the authenticated user.
2. Add a server-side checkout eligibility policy and use it on every surface.
3. Fix confirmation-required web signup and preserve the intended continuation.
4. **Done:** replace web Account's direct active-view reads with the shared billing-detail
   projection; distinguish read errors from free state.
5. Fix hosted recovery routing for already signed-in browsers.
6. Tighten desktop billing-button visibility. **Done:** paid/comp redemption now cancels
   the paid subscription.
7. Clean up the remaining account/header copy. **Done:** pricing and enforcement now share
   the three-site limit.
