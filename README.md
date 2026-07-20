# Talysman

A Windows-first (macOS-second) distraction blocker. A thin Electron control panel drives a
separate **privileged native service** that does the real OS-level enforcement, gated by a
paired USB key. Killing the UI does nothing; the service is the source of truth.

- **Architecture & design:** [`snorlax-architecture.md`](./snorlax-architecture.md)
- **How to build & run it on your machine:** [`build-guide.md`](./build-guide.md)

## Status

Implemented so far (architecture §19 phases 1–2):

- **Phase 1 — skeleton + mock service:** monorepo, config system, full Electron UI running
  against an in-process mock service, pure core logic with unit tests.
- **Phase 2 — Windows service v1 (Rust):** installs as a `LocalSystem` service, NDJSON-RPC
  over a named pipe, persisted state, USB pairing + presence, blacklist enforcement (local
  DNS sinkhole + user-mode WFP block filters + process-kill), and a **recovery-code
  killswitch** (`talysman-recover.exe`) as a safety net / support tool.

Not yet implemented (later phases): auth/payments, auto-update + signing, whitelist/block-all
WFP, DoH hardening, macOS.

## Quick start

```bash
pnpm install
pnpm typecheck
pnpm test        # Category-1 unit tests (run anywhere, incl. WSL/CI)
pnpm dev         # launches Supabase + Stripe forwarding + web + Electron
```

`pnpm dev` leaves the local Supabase containers running for fast restarts. Use
`pnpm dev:down` to stop them, or `pnpm dev:desktop` when only the Electron app is needed.

For the real enforcing build you must be on **native Windows** — see `build-guide.md`.
