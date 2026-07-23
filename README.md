# Talysman

Talysman is a cross-platform distraction blocker. A thin Electron control panel talks to a
separate privileged Rust service that owns focus state and performs OS-level enforcement. A
companion browser extension adds request-level blocking for traffic the host network layer cannot
identify reliably.

The repository also contains the Next.js account and billing service, Supabase migrations, release
automation, and installers for Windows, Linux, and macOS.

## Current status

The project is pre-1.0 but substantially implemented:

- Electron desktop UI with blocklists, schedules, USB-key pairing, account management, and a tray
  process.
- Privileged Rust services for Windows, Linux, and macOS, all speaking the same NDJSON-RPC
  protocol.
- Blacklist, whitelist, and block-all modes; app blocking; locked schedules; recovery tooling; and
  a browser-extension liveness watchdog.
- Chrome, Edge, Firefox, and Safari extension build paths with native-messaging integration.
- Supabase authentication, Stripe subscriptions and complimentary grants, desktop entitlement
  checks, and a 30-day offline entitlement lease.
- Signed-update/release plumbing: Windows/macOS generic update feeds, Linux APT publishing, S3
  artifact hosting, and extension-store packaging.

The native backends are not equivalent:

- Windows uses WinDivert plus Windows Firewall rules.
- Linux uses nftables, a resolver-fed IP bank, and optional dnsmasq integration.
- macOS currently uses `pf`, `/etc/hosts`, and a LaunchDaemon. Network Extension and Endpoint
  Security hardening remain future work and require Apple-managed entitlements.

This is security-sensitive software and still needs fail-closed/error-path hardening and clean-host
platform validation before its enforcement guarantees should be treated as production-ready.

## Repository map

| Path | Purpose |
| --- | --- |
| `apps/desktop` | Electron main, preload, and React renderer |
| `apps/web` | Next.js website, auth/billing API, Supabase migrations, and web tests |
| `apps/extension` | Browser extension source and store-submission material |
| `packages/shared` | Desktop/native RPC and domain contracts |
| `packages/core` | Pure policy, pairing, property-group, and schedule logic |
| `packages/product` | Plans, entitlements, and feature limits |
| `packages/billing-server` | Shared Stripe/Supabase billing operations |
| `native/{windows,linux,macos}` | Privileged Rust services and support binaries |
| `native/common` | Shared browser/watchdog logic |
| `scripts` | Development, build, release, and infrastructure automation |

See [snorlax-architecture.md](./snorlax-architecture.md) for the design and trust boundaries.

## Local development

Prerequisites for the complete stack are Node 22.12 or newer, pnpm 11, Docker, the Supabase CLI,
and the Stripe CLI. Copy `.credentials.example` to the gitignored `.credentials` and fill in the
local values first.

```bash
pnpm install
pnpm dev
```

`pnpm dev` generates local env files, starts Supabase, starts Stripe webhook forwarding, and then
launches the web and Electron apps. The attached processes stop on Ctrl+C; Supabase remains up for
fast restarts.

```bash
pnpm dev:down        # stop the local Supabase stack
pnpm dev:desktop     # Electron only
pnpm web:dev         # web app only
```

When no development native service is available, the unpackaged Electron app uses its in-process
mock service. Use a real native service for enforcement testing.

## Verification

The root and web projects have separate Vitest suites:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm web:test
pnpm --filter @talysman/web typecheck
pnpm audit:extension
```

Run native tests per crate:

```bash
cargo test --locked --manifest-path native/common/Cargo.toml
cargo test --locked --manifest-path native/linux/Cargo.toml
cargo test --locked --manifest-path native/macos/Cargo.toml
```

The Windows crate needs the WinDivert SDK/library configuration described in
[native/windows/README.md](./native/windows/README.md) and is best built and tested on native
Windows.

## Builds and releases

Production desktop builds require generated production environment values plus the platform's
native signing toolchain:

```bash
pnpm build:win
pnpm build:linux
pnpm build:mac
pnpm build:extension
```

Use these runbooks for the details:

- [deploy-guide.md](./deploy-guide.md) — web deployment, environment sync, desktop releases, APT,
  and artifact hosting
- [native/windows/README.md](./native/windows/README.md) — Windows service
- [native/linux/README.md](./native/linux/README.md) — Linux service
- [native/macos/README.md](./native/macos/README.md) — macOS service and current limitations
- [apps/extension/README.md](./apps/extension/README.md) — browser extension
- [extension-hosting.md](./extension-hosting.md) — store distribution
