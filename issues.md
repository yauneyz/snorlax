# Talysman Project Audit

Audited on July 23, 2026.

The project has a substantial implementation and a healthy automated test suite, but several trust-boundary, failure-handling, and release-process issues should be addressed before treating it as production-ready.

## Priority Overview

| Priority | Issue | Primary risk |
| --- | --- | --- |
| Critical | Users can overwrite their Stripe customer mapping | Cross-customer billing portal access |
| Critical | A focused device can pair a replacement physical key | Physical-presence protection can be bypassed |
| High | Production desktop startup silently falls back to a mock daemon | UI can report success without enforcement |
| High | Native state persistence is non-atomic and fail-open | Corruption can silently disable focus mode |
| High | `focus.active` does not prove enforcement is armed | Protection can fail while appearing enabled |
| High | Checkout can create duplicate subscriptions | Duplicate billing and support incidents |
| High | Release publishing is not gated by CI | Untested artifacts can be published |
| Medium | Webhook deduplication is race-prone | Duplicate side effects under concurrent delivery |
| Medium | Plan-limit application destroys saved policy | User configuration can be irreversibly lost |
| Medium | Desktop opens arbitrary external URL schemes | Unsafe protocol handling from renderer content |
| Medium | Extension store links are placeholders | Broken onboarding and misleading UI |
| Medium | Free-tier limits disagree across product surfaces | Confusing and inconsistent behavior |
| Medium | Public health endpoint contains a forced-error switch | Unnecessary production failure surface |
| Medium | Native core logic is duplicated across platforms | Security fixes can drift between platforms |

## Critical Issues

### 1. Authenticated users can overwrite the Stripe customer mapping

The initial profile row-level security policy allows an authenticated user to update their own entire profile row. The later grants migration also grants `UPDATE` on all profile columns. That includes `stripe_customer_id`.

The billing portal endpoint then trusts that stored value and creates a Stripe portal session for it. If a user learns another valid Stripe customer ID, they may be able to replace their own mapping and obtain a portal session for the other customer.

Relevant files:

- [`apps/web/supabase/migrations/0001_init.sql`](./apps/web/supabase/migrations/0001_init.sql), especially the profile update policy
- [`apps/web/supabase/migrations/0005_public_grants.sql`](./apps/web/supabase/migrations/0005_public_grants.sql), especially the profile update grant
- [`packages/billing-server/src/index.ts`](./packages/billing-server/src/index.ts), especially billing portal session creation

Recommended fix:

- Revoke broad profile updates from authenticated clients.
- Grant updates only for explicitly user-editable columns.
- Prefer moving billing identity data into a server-owned table that is inaccessible through normal client credentials.
- Before creating a billing portal session, verify that the Stripe customer belongs to the current application user, using trusted server-side metadata or an immutable server-controlled mapping.
- Audit existing profile rows for customer mappings that changed after creation.
- Add negative RLS and API tests proving that a user cannot write billing identity fields or create a portal session for another customer.

### 2. A focused device can pair a replacement physical key

The native `pairKey` flow accepts a newly presented key without requiring proof from the already paired key. Pairing writes the new key into state and recomputes presence, including while focus mode is active. A local process with IPC access can therefore replace the trusted key and regain control.

The IPC boundary is also broad:

- Unix sockets are created with mode `0666`.
- The Windows named pipe grants interactive users read/write access.

This weakens the core physical-key guarantee because local software can potentially invoke privileged pairing behavior directly.

Relevant files:

- [`native/windows/src/core.rs`](./native/windows/src/core.rs), especially the `pairKey` implementation
- [`native/linux/src/ipc.rs`](./native/linux/src/ipc.rs), especially socket permissions
- [`native/macos/src/ipc.rs`](./native/macos/src/ipc.rs)
- [`native/windows/src/ipc.rs`](./native/windows/src/ipc.rs), especially the named-pipe ACL

Recommended fix:

- Allow unauthenticated pairing only when no key has ever been paired and focus mode is off.
- Require the existing trusted key, a recovery secret, or another explicit privileged recovery flow before replacing a paired key.
- Refuse key replacement while focus mode is active.
- Restrict Unix sockets to the owning user or a dedicated service group.
- Authenticate the caller's user and session on Windows instead of trusting all interactive users.
- Narrow the browser/desktop bridge so renderer content cannot call unrestricted daemon methods.
- Add adversarial tests covering key replacement, focused-state pairing, cross-user IPC, and compromised-renderer behavior.

## High-Priority Issues

### 3. Production desktop startup silently falls back to a mock daemon

If the real native daemon does not become available shortly after startup, the desktop main process starts a mock daemon after a fixed delay. This fallback is not limited to development builds.

That creates a dangerous production failure mode: the application can continue operating and report successful state changes even though no real OS enforcement is active.

Relevant file:

- [`apps/desktop/src/main/index.ts`](./apps/desktop/src/main/index.ts)

Recommended fix:

- Compile or enable the mock daemon only in explicit development/test environments.
- Fail closed in production.
- Show a clear degraded or unavailable state and disable controls that imply enforcement.
- Add bounded retry, service-repair guidance, and an explicit user-visible error.
- Add a packaged-build test confirming that the mock path cannot activate.

### 4. Native state persistence is non-atomic and fail-open

Native state loading treats malformed or unreadable state as default state. Default state includes focus mode being inactive. State is persisted with direct file writes, and core persistence errors are swallowed.

A crash, partial write, disk-full condition, or malformed file can therefore silently reset security-critical state and disable focus mode.

Relevant files:

- Native state implementations under [`native/linux/src`](./native/linux/src), [`native/macos/src`](./native/macos/src), and [`native/windows/src`](./native/windows/src)
- Native core persistence paths, especially error handling after state mutations

Recommended fix:

- Write to a temporary file, flush it, and atomically rename it into place.
- Preserve a last-known-good backup and add an explicit state schema version.
- Treat unreadable or invalid security state as a startup error or retain the last enforced rules until recovery.
- Propagate persistence failures to the caller and UI.
- Do not acknowledge a state mutation until both durable state and enforcement have succeeded.
- Add fault-injection tests for truncated files, invalid JSON, disk-full errors, interrupted writes, and upgrade migrations.

### 5. `focus.active` does not prove that enforcement is armed

The native core sets the focus-active flag and returns success while rule application happens asynchronously or independently. On Linux, the firewall flow removes existing rules before applying replacements. If applying the replacement fails, protection may be absent even though application state still reports focus mode as active.

Relevant files:

- Native core focus-mode mutation paths
- Linux firewall/rule application code under [`native/linux/src`](./native/linux/src)
- Equivalent macOS and Windows enforcement backends

Recommended fix:

- Model enforcement with explicit states such as `arming`, `healthy`, `degraded`, and `failed`.
- Do not report focus activation as successful until critical enforcement is confirmed.
- Apply firewall/rule changes transactionally or by swapping a fully prepared ruleset.
- Keep the previous valid rules active if replacement fails.
- Surface enforcement health through IPC and the UI.
- Add tests where each native enforcement step fails independently.

### 6. Checkout can create duplicate subscriptions

Both checkout entry points can create a new Stripe Checkout session without first checking for an existing active or trialing subscription. The shared billing helper also creates sessions without an application-level idempotency or concurrency guard.

Repeated clicks, multiple tabs, retries, or concurrent requests can therefore create duplicate subscription attempts.

Relevant files:

- Checkout routes under [`apps/web`](./apps/web)
- [`packages/billing-server/src/index.ts`](./packages/billing-server/src/index.ts)

Recommended fix:

- Check the server-owned current subscription state before creating a Checkout session.
- Return the billing portal or a conflict response when a subscription is already active or trialing.
- Use Stripe idempotency keys derived from the authenticated user and purchase intent.
- Add a database uniqueness/concurrency guard where possible.
- Disable duplicate UI submissions, but do not rely on client-side protection.
- Add concurrent-request tests.

### 7. Release publishing is not gated by continuous integration

The repository has a release workflow, but no general pull-request or push CI workflow was found. The release path proceeds from dependency installation to publishing with release credentials without first running the repository's tests, type checks, lint checks, extension audit, or native test suites.

Relevant directory:

- [`.github/workflows`](./.github/workflows)

Recommended fix:

- Add CI for pull requests and protected branches.
- Run root and web tests, type checks, linting, extension audit, and native tests.
- Build or cross-check platform packages on appropriate runners.
- Make release jobs depend on successful validation.
- Re-run release-critical checks before exposing publishing credentials.
- Add branch protection requiring these checks.

## Medium-Priority Issues

### 8. Webhook deduplication is race-prone

Webhook handling checks whether an event has already been processed, performs side effects, and only then records completion. Concurrent deliveries of the same Stripe event can both pass the initial check and execute duplicate work.

Recommended fix:

- Atomically claim the event before processing it.
- Store explicit states such as `processing`, `completed`, and `failed`.
- Use a unique constraint on the provider event ID.
- Make downstream mutations idempotent.
- Consider a transactional outbox or queue for retries.
- Add a concurrency test that delivers the same event simultaneously.

### 9. Applying plan limits permanently destroys saved policy

`applyCurrentPlanLimits` truncates domains and applications and clears schedule data when authentication or entitlement state changes, including at startup. This permanently mutates the authored configuration rather than deriving a restricted effective configuration.

Users who temporarily lose entitlement or authentication can therefore lose policy they previously configured.

Recommended fix:

- Preserve the user's authored policy unchanged.
- Derive a separate effective policy according to current entitlements.
- Mark temporarily inactive entries in the UI instead of deleting them.
- Restore full behavior automatically when entitlement returns.
- Add downgrade, logout, offline-startup, and upgrade regression tests.

### 10. The desktop application opens arbitrary external URL schemes

The desktop window-open handler and related IPC path forward arbitrary strings to `shell.openExternal`. If renderer content is compromised or navigates unexpectedly, it can request non-HTTP protocols handled by the host.

Relevant files:

- Desktop main-process window and IPC handling under [`apps/desktop/src/main`](./apps/desktop/src/main)
- Desktop preload bridge under [`apps/desktop/src/preload`](./apps/desktop/src/preload)

Recommended fix:

- Parse URLs with the platform URL parser.
- Permit only `https:` by default.
- Add an explicit host allowlist for account, checkout, and support destinations.
- Reject credentials, malformed URLs, local-file schemes, and unexpected redirects.
- Narrow preload APIs to named actions instead of accepting arbitrary URL strings.
- Add protocol and host-validation tests.

### 11. Extension store links are placeholders

The website presents store-install actions whose targets are placeholders rather than real listings. That creates broken onboarding and can mislead users into expecting an available extension.

Recommended fix:

- Replace placeholder links with published store URLs when available.
- Until then, render the actions as non-clickable “Coming soon” states.
- Keep developer/manual installation instructions clearly separated from production installation instructions.
- Add a link checker that rejects placeholder production URLs.

### 12. Free-tier limits disagree across product surfaces

The pricing copy states a three-website free-tier limit while application constants allow five domains. This inconsistency affects product expectations, tests, and support.

Recommended fix:

- Choose one canonical entitlement definition.
- Generate pricing and in-app copy from shared product metadata where practical.
- Add a consistency test covering server limits, client limits, and published pricing copy.

### 13. The public health endpoint contains a forced-error switch

The health route accepts a query parameter that deliberately throws an error. This is useful during development, but it creates an unnecessary public production failure surface.

Recommended fix:

- Compile the switch out of production, restrict it to authenticated internal callers, or remove it.
- Keep synthetic error testing in dedicated observability tooling or non-production environments.

### 14. Security-sensitive native core logic is duplicated across platforms

Protocol handling, state transitions, and parts of enforcement orchestration are implemented separately in Linux, macOS, and Windows backends. That increases the chance that a security fix or behavioral change lands on one platform but not the others.

Recommended fix:

- Move protocol validation, state transitions, persistence rules, and shared invariants into a common Rust crate.
- Keep platform crates focused on enforcement adapters.
- Define a shared backend trait and run the same conformance suite against each implementation.
- Document unavoidable platform differences explicitly.

## Documentation Updates Already Made

The following documentation was refreshed during this audit:

- [`README.md`](./README.md)
- [`snorlax-architecture.md`](./snorlax-architecture.md)
- [`deploy-guide.md`](./deploy-guide.md)
- [`native/linux/README.md`](./native/linux/README.md)
- [`extension-hosting.md`](./extension-hosting.md)

The updates align setup, deployment, architecture, native-hosting, and extension-hosting instructions with the current repository. They also clarify current limitations and remove or correct stale commands and assumptions.

## Verification Performed

The following checks passed:

- Root test suite: 98 tests
- Web test suite: 70 tests
- Root TypeScript type check
- Web TypeScript type check
- Linting, with one existing explicit-`any` warning in `packages/billing-server/src/index.ts`
- Extension audit
- Shared native Rust tests: 16 tests
- Linux native Rust tests: 19 tests
- macOS native Rust tests: 46 tests
- Documentation link checks
- Git diff whitespace validation

The Windows native suite could not be run on the Linux audit host because `WINDIVERT_PATH` and the Windows SDK/runtime environment were unavailable.

Not exercised during this audit:

- Browser end-to-end tests requiring the full service stack
- Live Stripe billing flows
- Destructive or privileged native enforcement tests
- Packaged desktop behavior on each supported operating system
- A real Windows build and test run

## Recommended Implementation Order

1. Lock down profile RLS and server-owned billing identity.
2. Redesign key replacement and restrict native IPC authorization.
3. Remove the production mock-daemon fallback.
4. Make state persistence atomic and tie reported focus state to confirmed enforcement health.
5. Add subscription idempotency and atomic webhook claiming.
6. Add comprehensive CI and gate release publishing on it.
7. Preserve authored configuration when applying plan limits.
8. Address URL validation, placeholder links, entitlement-copy drift, the health endpoint, and native-code consolidation.
