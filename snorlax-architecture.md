# FocusLock — Architecture & Build Walkthrough

> A cross-platform (Windows-first, macOS-second) distraction blocker built on Electron,
> with native privileged helpers for real OS-level enforcement, gated by a paired USB key.

This document is the single source of truth for how the app is structured, why it's
structured that way, what every file does, and how it gets built, configured, and tested.

Codename used throughout: **FocusLock**. Rename freely (`focuslock` → your brand).

---

## Table of contents

1. [The one idea that drives the whole design](#1-the-one-idea-that-drives-the-whole-design)
2. [Threat model & honest limitations](#2-threat-model--honest-limitations)
3. [High-level architecture](#3-high-level-architecture)
4. [The privileged service (enforcement layer)](#4-the-privileged-service-enforcement-layer)
5. [USB pairing & presence detection](#5-usb-pairing--presence-detection)
6. [The IPC protocol (UI ⇄ service)](#6-the-ipc-protocol-ui--service)
7. [Policy model: blacklist / whitelist / block-all](#7-policy-model-blacklist--whitelist--block-all)
8. [Schedule system](#8-schedule-system)
9. [Focus on/off — the critical flows](#9-focus-onoff--the-critical-flows)
10. [Auth (Supabase) & payments (Stripe)](#10-auth-supabase--payments-stripe)
11. [Configuration & environments](#11-configuration--environments)
12. [Auto-update](#12-auto-update)
13. [Build process](#13-build-process)
14. [Full directory layout](#14-full-directory-layout)
15. [File-by-file reference](#15-file-by-file-reference)
16. [Testing strategy (3 categories)](#16-testing-strategy-3-categories)
17. [Tech stack summary](#17-tech-stack-summary)
18. [Prerequisites, signing & entitlements](#18-prerequisites-signing--entitlements)
19. [Suggested build phases](#19-suggested-build-phases)

---

## 1. The one idea that drives the whole design

**The Electron app does not block anything. A separate privileged service does.**

If blocking lived inside the Electron process, then killing that process in Task Manager
would disable the blocker — exactly the thing you want to prevent. So we split the system
into two layers:

| Layer | Privilege | Lifetime | Job |
|---|---|---|---|
| **Electron app** (UI) | Normal user | Runs only when the user opens it | Control panel. Edit blocklists, schedules, pair keys, sign in, toggle focus. Shows the red/green USB indicator. |
| **Privileged service** (daemon) | `LocalSystem` (Win) / `root` (mac) | Always on, auto-restarts, survives reboot | The authority. Holds the real focus state, enforces blocking at the network/process layer, owns the paired-key list, and independently verifies the USB key before ever allowing focus to be disabled. |

The two talk over a local IPC channel. **The service is the source of truth.** The UI is a
thin remote control whose green/red indicator simply mirrors what the service reports.

The single most important security property falls out of this:

> To disable focus mode, the UI sends a `disableFocus` request. The **service** then
> physically re-enumerates connected USB devices and checks for a paired key. If no paired
> key is present at that moment, the service refuses — no matter who sent the request or
> what they claimed. The UI cannot lie its way past this, because the UI's claim is never
> trusted; only the service's own hardware check counts.

---

## 2. Threat model & honest limitations

It's worth being precise about what "invulnerable" can and cannot mean, because over-promising
here leads to bad architecture.

**What we can make genuinely hard:**

| Attack | Defense |
|---|---|
| Kill the Electron UI in Task Manager | No effect — enforcement is in the service, not the UI. |
| Kill the service process | Service is configured to auto-restart (Windows SCM recovery actions / launchd `KeepAlive`). On Windows the network filters are installed as **persistent/boot-time** filters, so blocking continues even in the gap before the service restarts. |
| Edit the `hosts` file | No effect — we enforce at the network filtering layer (WFP / Network Extension), which sits below `hosts` resolution. `hosts` is irrelevant to us. |
| Change DNS server | We force all DNS through our local resolver via a firewall rule and block DNS-over-TLS / known DNS-over-HTTPS endpoints. |
| Uninstall the app | The uninstaller refuses to remove the service while focus mode is active unless a paired USB key is present. (Details in §9.) |
| Stop the service via `sc stop` / `launchctl` as a *standard* user | Service DACL / launchd permissions deny control to non-admins. |

**What we cannot fully prevent (and shouldn't pretend to):**

- **A determined user with local admin rights.** Admin can ultimately boot into safe mode,
  disable services, or wipe the disk. We can make this annoying and multi-step (which is
  enough to stop impulsive distraction-seeking — the actual product goal), but "unbreakable
  against root" is not a real thing on a machine the user controls.
- **VPNs / full tunnels.** A user can route around a host-based filter with a VPN. We can
  block *known* VPN binaries and unknown TUN/TAP adapters as a hardening step, but it's an
  arms race. Worth a setting, not worth obsessing over for v1.
- **macOS entitlements.** The strong macOS enforcement APIs (Network Extension content
  filtering, Endpoint Security) require **Apple-granted managed entitlements** on a paid
  developer account, plus user approval at install. This is a real gating dependency — see §18.

Design principle: **raise the activation energy of cheating above the activation energy of
just doing the work.** That's the achievable and correct goal.

---

## 3. High-level architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              USER SPACE (normal)                          │
│                                                                           │
│   ┌─────────────────────────── Electron App ─────────────────────────┐   │
│   │                                                                   │   │
│   │   Renderer (React UI)          Preload (contextBridge)            │   │
│   │   - Dashboard / focus toggle ──── window.api ────┐                │   │
│   │   - Blocklists / Schedule                        │                │   │
│   │   - Keys (USB pairing)                           ▼                │   │
│   │   - Account (auth/payments)        Main process (Node)            │   │
│   │   - UsbIndicator (red/green)       - Supabase auth               │   │
│   │                                    - Stripe entitlement check     │   │
│   │                                    - electron-updater             │   │
│   │                                    - Service IPC client ──────────┼─┐ │
│   │                                    - Tray icon (mirrors USB state)│ │ │
│   └───────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────│─┘
                                                                          │
                    local IPC (named pipe / unix socket, NDJSON-RPC)      │
                                                                          │
┌─────────────────────────────────────────────────────────────────────│─┐
│                         PRIVILEGED SPACE (SYSTEM / root)              ▼  │
│                                                                         │
│   ┌──────────────────────── FocusLock Service ───────────────────────┐  │
│   │                                                                   │  │
│   │   IPC server  ──►  State (authoritative)  ──►  Enforcement       │  │
│   │                     - focus on/off              ┌───────────────┐ │  │
│   │   USB monitor ──►   - active policy             │ Windows:      │ │  │
│   │   (event-driven)    - schedule                  │  WFP filters  │ │  │
│   │                     - paired key set            │  local DNS    │ │  │
│   │   Schedule timer ─► (flips focus on/off)        │  proc monitor │ │  │
│   │                                                 ├───────────────┤ │  │
│   │   Secure store ──►  paired serials + secrets    │ macOS:        │ │  │
│   │   (DPAPI / Keychain)                            │  NE filter    │ │  │
│   │                                                 │  ES exec deny │ │  │
│   │                                                 └───────────────┘ │  │
│   └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

**Repository shape** is a TypeScript monorepo (pnpm workspaces) with native subprojects:

- `apps/desktop` — the Electron app (main + preload + renderer).
- `packages/shared` — types & the IPC contract, imported by both UI and tests.
- `packages/core` — pure cross-platform business logic (schedule engine, policy normalize,
  pairing crypto) so it's testable without Electron or native code.
- `native/windows` — the Windows service (Rust + `windows-rs`).
- `native/macos` — the macOS daemon + Network/System Extension (Swift).
- `native/protocol` — the language-neutral RPC schema both sides implement.
- `scripts`, `config`, `tests` — orchestration, config loading, and the three test suites.

---

## 4. The privileged service (enforcement layer)

The service is one long-running privileged process per OS. It is small, boring, and
defensive. Its responsibilities:

1. Host the **IPC server** the UI connects to.
2. Hold **authoritative state**: `{ focusActive, policy, schedule, pairedKeys }`, persisted
   to a protected on-disk store so it survives restarts.
3. Run the **USB monitor** (event-driven) and broadcast key-presence changes.
4. Run the **schedule timer** that flips focus on/off at window boundaries.
5. **Enforce** the active policy through the OS network/process APIs.
6. **Guard the disable path**: independently verify a paired key is physically present
   before honoring any `disableFocus`.

### 4.1 Windows enforcement

Built in **Rust** with the [`windows`](https://crates.io/crates/windows) crate (full WFP,
SetupAPI, Service Control Manager, DPAPI bindings). Rust is recommended over C++/C# because
it gives us memory safety in a SYSTEM-level process and first-class bindings to every Win32
API we need. (C++ is a fine alternative if the team prefers it.)

**Website / network blocking — Windows Filtering Platform (WFP):**

We do *not* touch the `hosts` file. Instead:

- A small **local DNS resolver** (sinkhole) runs inside the service on `127.0.0.1:53`.
  For blocked domains it returns `NXDOMAIN`/`0.0.0.0`; for allowed domains it forwards
  upstream. Whitelist mode inverts the default; "block all internet" sinkholes everything.
- **WFP filters** force the policy at the network layer:
  - Redirect all outbound port-53 traffic to our local resolver (so changing the system
    DNS server does nothing).
  - Block outbound port 853 (DNS-over-TLS) and a maintained list of DNS-over-HTTPS
    endpoint IPs, so browsers can't bypass our resolver via DoH.
  - In **whitelist** and **block-all** modes, add `FWPM_LAYER_ALE_AUTH_CONNECT_V4/V6`
    filters that block all outbound connections except to allowed destinations.
- Filters are added with `FWPM_FILTER_FLAG_PERSISTENT` and the provider/sublayer are
  **boot-time persistent**. This is the key anti-tamper trick: **if the service is killed,
  the filters remain in force** until the OS clears them, and the service re-arms on boot.

**App blocking — process monitoring:**

- Subscribe to process-creation events (ETW `Microsoft-Windows-Kernel-Process`, or WMI
  `__InstanceCreationEvent` on `Win32_Process`).
- On a match against the blocked-app list, `TerminateProcess` immediately.
- v1 uses this user-mode SYSTEM approach. *Pre-execution* denial (stopping the process
  before it ever runs) requires a signed kernel minifilter driver — noted as a future
  hardening step, not a v1 requirement, because driver signing is expensive and slow.

**Persistence & self-protection:**

- Installed as a Windows Service, `SERVICE_AUTO_START`, account `LocalSystem`.
- Recovery configured: `sc failure ... actions= restart/1000/restart/1000/restart/1000`
  so the SCM restarts it on crash/kill.
- Service security descriptor (DACL) denies `SERVICE_STOP`/`SERVICE_DELETE` to non-admins.
- (Advanced/optional) Protected Process Light to resist admin kills — requires special
  EV/attestation code-signing; out of scope for v1.

### 4.2 macOS enforcement

Built in **Swift** (required: the Network Extension and Endpoint Security entitlements and
their System Extension packaging are first-class only through the Apple toolchain).

**Website / network blocking — Network Extension content filter:**

- A **System Extension** containing an `NEFilterDataProvider` is embedded in the app bundle
  (`Contents/Library/SystemExtensions/`). It inspects outbound flows and allows/denies by
  hostname/URL and originating app, implementing the same policy model as Windows.
- Requires the `com.apple.developer.networking.networkextension` entitlement
  (`content-filter-provider`) and user approval in **System Settings → Network**.

**App blocking — Endpoint Security:**

- The root daemon is an **Endpoint Security client** subscribed to
  `ES_EVENT_TYPE_AUTH_EXEC`. For blocked apps it returns a deny verdict, so the app never
  launches (cleaner than killing-after-launch on Windows).
- Requires the `com.apple.developer.endpoint-security.client` entitlement (Apple-approved).

**Persistence:**

- A **LaunchDaemon** plist in `/Library/LaunchDaemons/` with `RunAtLoad=true` and
  `KeepAlive=true` — launchd restarts it if it dies.
- The System Extension is managed by macOS and requires admin + user approval to remove.

### 4.3 Cross-platform contract

Both implementations expose the **same RPC surface** (§6) and consume the **same normalized
policy** (§7). All platform-specific code hides behind an internal `Enforcer` trait/protocol
with one method conceptually: `apply(policy, focusActive)`. The UI and shared logic never
know which OS they're on.

---

## 5. USB pairing & presence detection

### 5.1 What "a paired key" is

We bind to two things for defense in depth:

1. **Device identity** — the `(VID, PID, serialNumber)` tuple of the USB device. This is
   what we poll/enumerate to answer "is the key plugged in right now?" cheaply.
2. **A secret key file** — at pairing time we generate a random 256-bit secret, write it to
   a file on the drive (e.g. `/.focuslock/key.bin`), and store a salted hash of the secret
   in the service's secure store. This is a second factor: it defeats someone who merely
   spoofs a serial number, and it lets us detect cloned drives.

Storing the device identity is what makes presence detection fast and what stops the trivial
"copy the key file to any stick" attack. The key file stops the "fake the serial" attack.
Either alone is weaker; together they're solid for the product's purpose.

> **Caveat to bake into the UX:** some cheap USB sticks report no serial, or a duplicated
> serial shared across a whole production batch. During pairing we detect this and warn the
> user ("this drive can't be uniquely identified; presence will rely on the key file only"),
> and we fall back to volume serial + key file.

You can **pair as many keys as you like** — `pairedKeys` is a set. Any one present unlocks.

### 5.2 Pairing flow

1. User opens **Keys** page, clicks "Pair a new key," inserts a drive.
2. UI asks the service to enumerate removable drives; user picks one.
3. Service (privileged): reads `(VID, PID, serial)` + volume serial; generates a random
   secret; writes `key.bin` to the drive; stores `{ id, label, serialHash, secretHash }`
   in the secure store (DPAPI-encrypted on Windows / Keychain on macOS).
4. UI confirms; the new key appears in the list.

### 5.3 Presence detection (event-driven, with polling fallback)

We prefer **events** over polling so the red/green indicator updates instantly and we don't
burn CPU:

- **Windows:** the service listens for `WM_DEVICECHANGE` (`DBT_DEVICEARRIVAL` /
  `DBT_DEVICEREMOVECOMPLETE`). On any change it re-enumerates via SetupAPI/CfgMgr32 and
  recomputes presence. A low-frequency safety poll (e.g. every 10 s) covers edge cases.
- **macOS:** `IOKit` device-add/remove notifications + `DiskArbitration` for mounted
  volumes; same recompute-on-event pattern.

When presence changes, the service **pushes** a `keyPresenceChanged` event to the UI over the
IPC channel. The UI never polls the hardware itself — it just renders whatever the service
last told it. The tray icon and the in-app `UsbIndicator` both subscribe to this one event.

```
USB plugged in ──► OS device event ──► service re-enumerates ──► matches a pairedKey?
                                                                      │
                          ┌───────────────────────────────────────────┘
                          ▼
         service.state.keyPresent = true ──► push keyPresenceChanged{present:true}
                          │
                          ▼
            UI sets indicator GREEN; tray icon swaps to green
```

---

## 6. The IPC protocol (UI ⇄ service)

**Transport:** a local stream socket.
- Windows: named pipe `\\.\pipe\focuslock`.
- macOS: unix domain socket `/var/run/focuslock.sock` (or an XPC service).

**Wire format:** newline-delimited JSON (NDJSON). Each line is one message. Two message
kinds: request/response (RPC) and server-pushed events. The contract is defined **once** in
`packages/shared/src/protocol.ts` (TypeScript types) and mirrored by a language-neutral
schema in `native/protocol/` that the Rust and Swift servers conform to.

**Why a socket and not Electron `ipcMain`:** `ipcMain` is only for renderer↔main. The UI's
*main* process is the IPC client here; the *service* is a separate privileged process, so we
need a real OS IPC channel between them.

### Requests (UI → service)

| Method | Payload | Returns | Notes |
|---|---|---|---|
| `getState` | – | full state snapshot | called on connect |
| `setPolicy` | `Policy` | ok | edit blocklists / mode |
| `setSchedule` | `Schedule` | ok | replace schedule |
| `enableFocus` | `{ reason }` | ok | turn blocking on |
| `disableFocus` | `{ }` | ok \| `KEY_REQUIRED` | **service re-checks USB presence itself** |
| `listRemovableDrives` | – | `Drive[]` | for the pairing picker |
| `pairKey` | `{ driveId, label }` | `PairedKey` | writes key file, stores identity |
| `unpairKey` | `{ keyId }` | ok \| `KEY_REQUIRED` | removing a key is itself key-gated |
| `getKeyPresence` | – | `{ present, keyId? }` | one-shot read of indicator state |
| `ping` | – | `{ version }` | health/version check for updater |

### Events (service → UI, pushed)

| Event | Payload | Meaning |
|---|---|---|
| `keyPresenceChanged` | `{ present, keyId? }` | drives the red/green indicator |
| `focusChanged` | `{ active, source }` | focus toggled (by user, schedule, or boot) |
| `policyChanged` | `Policy` | state changed, UI should refresh |
| `scheduleFired` | `{ windowId, active }` | a schedule window started/ended |

**Security at the boundary:** the channel is local-only. The disable path does **not** trust
the caller — `disableFocus` and `unpairKey` cause the service to physically re-verify a paired
key is present *at that instant* before acting. So even a malicious local process speaking the
protocol can't disable focus without the physical key.

---

## 7. Policy model: blacklist / whitelist / block-all

Defined in `packages/shared/src/policy.ts`, normalized in `packages/core/src/policyNormalize.ts`.

```ts
type Mode = 'blacklist' | 'whitelist' | 'block-all';

interface Policy {
  mode: Mode;
  domains: string[];   // e.g. ["youtube.com", "*.reddit.com"]
  apps: AppRef[];      // platform-neutral app identity (see below)
}

interface AppRef {
  // matched per-platform; populate the field relevant to the OS
  windowsImageName?: string;   // "chrome.exe"
  macBundleId?: string;        // "com.google.Chrome"
  label: string;               // user-facing name
}
```

**Mode semantics:**

- **blacklist** — everything allowed *except* listed domains/apps.
- **whitelist** — everything blocked *except* listed domains/apps (e.g. allow only Gmail +
  your work tools). Implemented as default-deny network filters + allow rules.
- **block-all** — total network block; apps optionally still allowed unless also listed.

`policyNormalize.ts` is pure and unit-tested: it lowercases/validates domains, expands
wildcards into the matcher form each enforcer expects, dedupes, and rejects nonsense. The
**normalized** policy is what crosses the IPC boundary to the service, so the privileged code
receives clean, validated input and never has to parse user free-text.

---

## 8. Schedule system

A schedule is a set of recurring windows. The engine that decides "should focus be on right
now?" is **pure** (`packages/core/src/scheduleEngine.ts`) so it's trivially unit-tested, but
it **runs inside the service**, not the UI — so schedules fire even when the app is closed.

```ts
interface ScheduleWindow {
  id: string;
  days: Weekday[];          // ['mon','tue','wed','thu','fri']
  start: string;            // "09:00" (local time)
  end: string;              // "17:00"
  policyId?: string;        // optionally a different policy per window
  locked: boolean;          // if true, USB key cannot disable during this window
}
interface Schedule { windows: ScheduleWindow[]; }
```

- The service keeps a timer that wakes at the next boundary, calls the pure engine to
  evaluate the current state, and flips focus accordingly — emitting `focusChanged` /
  `scheduleFired`.
- `locked` windows are the "no escape" mode: during a locked window even a present USB key
  won't disable focus. Manual (non-scheduled) focus is always key-disableable. This gives
  you both "soft" and "hard" commitment options.
- All times are evaluated in the machine's local timezone; DST handled by computing against
  wall-clock local time, not stored UTC offsets.

---

## 9. Focus on/off — the critical flows

### Enabling focus (easy, no gate)

```
User taps Focus toggle ──► UI: enableFocus ──► service sets focusActive=true,
applies policy via enforcer ──► pushes focusChanged{active:true} ──► UI shows "Focused".
```

### Disabling focus (the gate)

```
User taps Focus toggle OFF
        │
        ▼
UI: disableFocus  ───────────────►  SERVICE
                                      │ 1. Is a schedule 'locked' window active?  ── yes ─► refuse (LOCKED)
                                      │ 2. Re-enumerate USB devices NOW
                                      │ 3. Any connected device matches a pairedKey
                                      │    (serial match AND key.bin secret verifies)?
                                      │        │
                                 no ──┘        └── yes
                                  │                  │
                                  ▼                  ▼
                          return KEY_REQUIRED   focusActive=false, tear down filters,
                                  │              push focusChanged{active:false}
                                  ▼
                    UI shows "Insert your key to unlock"
                    (indicator already RED, so user sees why)
```

The service performs steps 2–3 itself every single time. The UI's cached "key present" flag
is never sufficient — it's only there to render the indicator and give a helpful message.

### Uninstall protection

- **Windows:** the NSIS uninstaller runs a hook (`nsis-include.nsh`) that asks the service
  "is focus active and is no key present?" — if so it aborts with a message. The service's
  files and the persistent WFP filters can't be cleanly removed while armed.
- **macOS:** the System Extension and LaunchDaemon require admin + user approval to remove;
  the uninstaller refuses to deactivate the extension while focus is locked and no key is
  present.

(As stated in §2: a local admin can still force the issue by lower-level means. That's fine —
the bar is "annoying enough to defeat impulse," not "defeats a motivated sysadmin.")

---

## 10. Auth (Supabase) & payments (Stripe)

### Auth

- `supabase-js` runs in the **main** process (`src/main/auth/supabase.ts`), not the renderer,
  so tokens never live in DOM-accessible memory.
- The session (refresh token) is persisted with Electron `safeStorage` (OS keychain /
  DPAPI), in `src/main/auth/session.ts`.
- The renderer asks the main process to sign in / out via the preload bridge; it only ever
  receives "are we signed in + basic profile," never raw tokens.

### Payments — important security note

> **Do not put your Stripe *secret* key in the app.** A desktop client is fully inspectable;
> anything shipped in it is public. The client only ever handles the **publishable** key.

Recommended flow, which still matches your "redirect to a URL we own" and "ping Stripe"
requirements:

1. **Purchase:** the Account page opens your owned hosted page (`PAYMENT_URL`) in the
   external browser (`shell.openExternal`). That page runs Stripe Checkout. After payment,
   Stripe redirects back to a deep link (`focuslock://billing/return`) that re-focuses the app.
2. **Verification:** the app calls a **Supabase Edge Function** (your backend) that holds the
   Stripe *secret* key and queries Stripe for the user's subscription status. The client
   "pings Stripe" *through* this function — never directly with a secret. The function writes
   an `entitlement` row guarded by RLS.
3. **Entitlement check:** `src/main/auth/subscription.ts` reads that entitlement on launch
   and caches it locally with an **offline grace period** (e.g. 7 days) so a flaky network
   doesn't lock a paying user out — and, importantly, so a lapse can't suddenly *unblock*
   someone mid-focus-session.

Gating rule: a valid subscription is required to **configure and start** focus. Once focus is
active it stays active until the USB key disables it, regardless of subscription state — you
never want billing logic to become a backdoor that unlocks the blocker.

---

## 11. Configuration & environments

We split config into **public** (safe to ship) and **secret** (never shipped), and we support
clean dev/prod separation with local overrides.

### What's public vs secret

| Var | Public? | Used where |
|---|---|---|
| `APP_ENV` (`development`/`production`) | public | everywhere |
| `SUPABASE_URL` | public | main |
| `SUPABASE_ANON_KEY` | public (anon key is publishable) | main |
| `STRIPE_PUBLISHABLE_KEY` | public | renderer/checkout page |
| `PAYMENT_URL` (your owned billing page) | public | renderer |
| `API_BASE_URL` (your edge functions) | public | main |
| `UPDATE_FEED_URL` | public | updater |
| `STRIPE_SECRET_KEY` | **SECRET — never in the app** | Supabase Edge Function only |

### `.env` files & precedence

Standard Vite/electron-vite convention. Precedence (highest wins):

```
.env.local            ← gitignored; YOUR machine's overrides (e.g. local Supabase URL)
.env.<mode>           ← .env.development / .env.production (committed, non-secret)
.env                  ← shared defaults (committed, non-secret)
```

- **Dev build** runs with `APP_ENV=development` → picks up `.env.development`, which points
  at **Supabase local** (`http://localhost:54321`) and **Stripe test** keys. Override per
  machine in `.env.local`.
- **Prod build** runs with `APP_ENV=production` → `.env.production` with live endpoints.

### How config reaches the code (the right way for Electron)

- Public vars are inlined at **build time** by electron-vite. Renderer vars must be prefixed
  (e.g. `VITE_SUPABASE_URL`) and are exposed as `import.meta.env.VITE_*`. Main-process vars
  are injected via the `define`/`loadEnv` mechanism in `electron.vite.config.ts`.
- **All config is validated once** through a Zod schema (`config/schema.ts`) at startup via
  `config/load.ts`. If a required var is missing or malformed, the app fails fast with a
  clear error instead of misbehaving later. `scripts/gen-config.mjs` can emit a typed
  `config.d.ts` so usage is autocompleted and type-checked.
- Never read raw `process.env` scattered across the codebase — everything goes through the
  validated `config` object. One import, fully typed, environment-correct.

The native services don't need build-time secrets at all; the only thing they need to know is
the IPC pipe/socket name, which is a hardcoded constant in `packages/shared/src/constants.ts`
(and mirrored in native).

---

## 12. Auto-update

- **`electron-updater`** (paired with electron-builder) checks `UPDATE_FEED_URL` (GitHub
  Releases, S3, or a generic feed). Wired in `src/main/updater.ts`: check on launch +
  periodically, download in background, prompt to restart.
- **Code signing is mandatory** for auto-update to work (Windows Authenticode + macOS
  Developer ID + notarization). Unsigned auto-update is blocked by the OS.
- **The native service needs special handling:** electron-updater updates the *Electron app*,
  but the *privileged service binary* lives outside the user-writable app dir and updating it
  needs elevation. Strategy: bundle the service binary's version; on launch
  `src/main/service/installer.ts` calls `ping` and compares versions; if the shipped service
  is newer, it runs a one-time elevated install/repair to swap the service binary, then
  restarts the service. So a normal app auto-update silently carries a service upgrade with a
  single elevation prompt only when the service actually changed.
- `dev-app-update.yml` lets you test the update flow locally without publishing.

---

## 13. Build process

Goal: `pnpm build:win` / `pnpm build:mac` produce a signed, auto-updatable installer with the
native service embedded, in one command.

### The orchestration (`scripts/build.mjs`)

```
1. Validate config        → scripts/gen-config.mjs (zod-check .env for the target mode)
2. Build native helper    → scripts/build-native-win.mjs OR build-native-mac.mjs
      Windows:  cargo build --release   → copy focuslock-svc.exe → apps/desktop/resources/bin/win/
      macOS:    xcodebuild (daemon + sysext) → sign → copy into apps/desktop/resources/bin/mac/
3. Build Electron bundles → electron-vite build (main + preload + renderer)
4. Package + sign         → electron-builder (NSIS on Win / pkg+dmg on Mac)
      - embeds resources/bin/* into the app's resources
      - runs installer hooks that register/start the service (Win) or stage the LaunchDaemon
        + System Extension (Mac)
5. (mac) Notarize         → scripts/sign-notarize-mac.mjs (notarytool + staple)
```

### Dev loop (`scripts/dev.mjs`)

- Runs `electron-vite dev` with HMR for the renderer and live-reload for main/preload.
- Builds the native helper in **debug** mode and runs it as a normal console process (not a
  registered service) so you don't need elevation on every code change. The service detects
  `APP_ENV=development` and uses a dev pipe name + relaxed install so the inner loop is fast.
- `APP_ENV=development` → Supabase local + Stripe test automatically (see §11).

### Top-level scripts (root `package.json`)

```jsonc
{
  "scripts": {
    "dev":        "node scripts/dev.mjs",
    "build:win":  "cross-env APP_ENV=production node scripts/build.mjs --target win",
    "build:mac":  "cross-env APP_ENV=production node scripts/build.mjs --target mac",
    "build:dev":  "cross-env APP_ENV=development node scripts/build.mjs",
    "test":       "pnpm test:electron",
    "test:electron": "vitest run && playwright test",
    "test:win":   "node scripts/run-platform-tests.mjs --target win",
    "test:mac":   "node scripts/run-platform-tests.mjs --target mac",
    "lint":       "eslint . && cargo clippy && swiftlint",
    "typecheck":  "tsc -b"
  }
}
```

---

## 14. Full directory layout

```
focuslock/
├─ package.json                      # root: workspaces + orchestration scripts
├─ pnpm-workspace.yaml               # pnpm workspaces definition
├─ turbo.json                        # (optional) task pipeline / caching
├─ tsconfig.base.json                # shared TS config, path aliases
├─ .gitignore
├─ .env.example                      # documents every var (committed)
├─ .env                              # shared non-secret defaults (committed)
├─ .env.development                  # dev endpoints: supabase local, stripe test (committed)
├─ .env.production                   # prod endpoints (committed, non-secret only)
├─ .env.local                        # per-machine overrides (GITIGNORED)
├─ electron-builder.yml              # packaging: targets, signing, installer hooks
├─ dev-app-update.yml                # local auto-update testing feed
├─ README.md
│
├─ apps/
│  └─ desktop/                       # ===== the Electron application =====
│     ├─ package.json
│     ├─ electron.vite.config.ts     # main/preload/renderer build + env injection
│     ├─ tsconfig.json
│     ├─ src/
│     │  ├─ main/                     # ----- MAIN process (Node) -----
│     │  │  ├─ index.ts              # app lifecycle, single-instance, window, tray bootstrap
│     │  │  ├─ window.ts             # BrowserWindow + deep-link (focuslock://) handling
│     │  │  ├─ tray.ts               # system tray; swaps green/red icon on keyPresenceChanged
│     │  │  ├─ config.ts             # builds the typed, validated runtime config object
│     │  │  ├─ logging.ts            # electron-log setup
│     │  │  ├─ updater.ts            # electron-updater wiring
│     │  │  ├─ ipc/
│     │  │  │  ├─ channels.ts        # renderer↔main channel name constants
│     │  │  │  └─ handlers.ts        # ipcMain handlers the preload calls into
│     │  │  ├─ service/
│     │  │  │  ├─ client.ts          # NDJSON-RPC client over pipe/socket to the service
│     │  │  │  ├─ protocol.ts        # re-exports packages/shared protocol types
│     │  │  │  └─ installer.ts       # install/repair/upgrade the privileged service (elevation)
│     │  │  └─ auth/
│     │  │     ├─ supabase.ts        # supabase-js client (main process)
│     │  │     ├─ session.ts         # persist session via safeStorage / keychain
│     │  │     └─ subscription.ts    # entitlement check via edge function + offline grace
│     │  ├─ preload/
│     │  │  └─ index.ts              # contextBridge: the ONLY API surface the UI can touch
│     │  └─ renderer/                 # ----- RENDERER (React UI) -----
│     │     ├─ index.html
│     │     ├─ main.tsx              # React root
│     │     ├─ App.tsx               # layout + routing
│     │     ├─ lib/
│     │     │  ├─ bridge.ts          # typed wrapper over window.api + event subscriptions
│     │     │  └─ utils.ts
│     │     ├─ store/
│     │     │  └─ useFocusStore.ts   # zustand store mirroring service state
│     │     ├─ pages/
│     │     │  ├─ Dashboard.tsx      # focus toggle + USB indicator + current status
│     │     │  ├─ Blocklists.tsx     # mode switch + domain/app list editor
│     │     │  ├─ Schedule.tsx       # weekly schedule editor with locked-window toggle
│     │     │  ├─ Keys.tsx           # USB pairing: pick drive, pair, list, unpair
│     │     │  ├─ Account.tsx        # auth + subscription status + "Manage billing" redirect
│     │     │  └─ Settings.tsx       # general prefs, update channel, about
│     │     ├─ components/
│     │     │  ├─ UsbIndicator.tsx   # the red/green dot, bound to keyPresenceChanged
│     │     │  ├─ FocusToggle.tsx    # big on/off control with key-required messaging
│     │     │  ├─ DomainList.tsx
│     │     │  ├─ AppPicker.tsx
│     │     │  └─ ui/                 # shadcn/ui primitives (button, dialog, switch, …)
│     │     └─ styles/
│     │        └─ globals.css        # tailwind layers + theme tokens
│     ├─ resources/
│     │  ├─ icon.ico / icon.icns / icon.png
│     │  ├─ tray-green.png / tray-red.png
│     │  ├─ entitlements.mac.plist   # hardened-runtime entitlements for the app
│     │  └─ bin/                      # native binaries embedded at build time
│     │     ├─ win/                   # focuslock-svc.exe (+ deps) — populated by build
│     │     └─ mac/                   # FocusLockDaemon, *.systemextension — populated by build
│     └─ build/                       # electron-builder extra resources (installer art, etc.)
│
├─ packages/
│  ├─ shared/                        # ===== cross-cutting TS types & the IPC contract =====
│  │  ├─ package.json
│  │  └─ src/
│  │     ├─ index.ts
│  │     ├─ protocol.ts              # SINGLE SOURCE OF TRUTH for RPC requests/responses
│  │     ├─ events.ts                # pushed-event types (keyPresenceChanged, …)
│  │     ├─ policy.ts                # Policy / Mode / AppRef types
│  │     ├─ schedule.ts              # Schedule / ScheduleWindow types
│  │     └─ constants.ts             # pipe/socket names, deep-link scheme, versions
│  └─ core/                          # ===== pure cross-platform business logic =====
│     ├─ package.json
│     └─ src/
│        ├─ scheduleEngine.ts        # pure: "is focus on right now?" given schedule + clock
│        ├─ policyNormalize.ts       # pure: validate/normalize user policy → enforcement form
│        └─ pairing.ts               # pure: secret generation, hash, verify helpers
│
├─ native/
│  ├─ protocol/
│  │  └─ schema.json                 # language-neutral mirror of packages/shared/protocol.ts
│  ├─ windows/                       # ===== Windows privileged service (Rust) =====
│  │  ├─ Cargo.toml
│  │  ├─ build.rs
│  │  ├─ src/
│  │  │  ├─ main.rs                  # SCM dispatch entry point
│  │  │  ├─ service.rs               # Windows Service lifecycle, recovery, DACL
│  │  │  ├─ ipc.rs                   # named-pipe NDJSON-RPC server
│  │  │  ├─ state.rs                 # authoritative state + persistence
│  │  │  ├─ secure_store.rs          # DPAPI-encrypted store (paired serials, secret hashes)
│  │  │  ├─ usb.rs                   # WM_DEVICECHANGE + SetupAPI enumeration
│  │  │  ├─ pairing.rs               # verify a present device matches a paired key
│  │  │  ├─ schedule.rs              # timer driving the (shared-logic-equivalent) engine
│  │  │  └─ enforce/
│  │  │     ├─ mod.rs                # Enforcer trait: apply(policy, focusActive)
│  │  │     ├─ wfp.rs                # WFP filters (persistent/boot-time)
│  │  │     ├─ dns.rs                # local DNS sinkhole + DoH/DoT blocking
│  │  │     └─ apps.rs               # process-creation monitor + terminate
│  │  └─ installer/
│  │     ├─ service-install.rs       # tiny elevated CLI: create/configure/recover/remove svc
│  │     └─ nsis-include.nsh         # NSIS hooks: install/start svc; guard uninstall
│  └─ macos/                         # ===== macOS daemon + system extension (Swift) =====
│     ├─ project.yml                 # XcodeGen spec (generates the .xcodeproj)
│     ├─ FocusLock.entitlements      # network-extension + endpoint-security + app groups
│     ├─ FocusLockDaemon/            # the root LaunchDaemon
│     │  ├─ main.swift               # entry; loads state; starts IPC + monitors
│     │  ├─ IPCServer.swift          # unix-socket / XPC NDJSON-RPC server
│     │  ├─ State.swift              # authoritative state + persistence
│     │  ├─ SecureStore.swift        # Keychain-backed paired keys
│     │  ├─ USBMonitor.swift         # IOKit + DiskArbitration presence
│     │  ├─ Pairing.swift            # verify present device matches a paired key
│     │  ├─ ScheduleEngine.swift     # timer-driven schedule enforcement
│     │  └─ AppBlocker.swift         # Endpoint Security AUTH_EXEC deny
│     ├─ FocusLockFilter/            # the Network Extension (System Extension)
│     │  ├─ FilterDataProvider.swift # NEFilterDataProvider: domain/app/all enforcement
│     │  └─ Info.plist
│     └─ Resources/
│        └─ com.focuslock.daemon.plist  # LaunchDaemon plist (KeepAlive, RunAtLoad)
│
├─ scripts/
│  ├─ build.mjs                      # orchestrates the full build (see §13)
│  ├─ build-native-win.mjs           # cargo build → copy into resources/bin/win
│  ├─ build-native-mac.mjs           # xcodebuild → sign → copy into resources/bin/mac
│  ├─ dev.mjs                        # dev loop: electron-vite dev + native debug runner
│  ├─ sign-notarize-mac.mjs          # codesign + notarytool + staple
│  ├─ gen-config.mjs                 # validate .env (zod) + emit typed config.d.ts
│  └─ run-platform-tests.mjs         # selects + runs the win/mac native test suites
│
├─ config/
│  ├─ schema.ts                      # zod schema for ALL config vars
│  └─ load.ts                        # precedence loader (.env.local > .env.<mode> > .env)
│
└─ tests/
   ├─ electron/                      # ===== category 1: runs anywhere (CI) =====
   │  ├─ unit/                       # vitest: scheduleEngine, policyNormalize, pairing, config
   │  │  ├─ scheduleEngine.test.ts
   │  │  ├─ policyNormalize.test.ts
   │  │  └─ pairing.test.ts
   │  └─ e2e/                        # playwright-electron: UI flows with a MOCK service
   │     ├─ focus-toggle.spec.ts
   │     ├─ blocklists.spec.ts
   │     └─ pairing-ui.spec.ts
   ├─ windows/                       # ===== category 2: run on a Windows host =====
   │  ├─ service-lifecycle.spec.ts   # install, kill, auto-restart, recovery, DACL
   │  ├─ wfp-blocking.spec.ts        # blocked domain unreachable; hosts edit is a no-op
   │  ├─ dns-bypass.spec.ts          # DoH/DoT bypass is blocked
   │  ├─ app-blocking.spec.ts        # blocked exe gets terminated
   │  └─ usb-presence.spec.ts        # pair + plug/unplug → presence flips correctly
   ├─ mac/                           # ===== category 3: run on a macOS host =====
   │  ├─ daemon-lifecycle.spec.ts    # LaunchDaemon KeepAlive restart
   │  ├─ filter-blocking.spec.ts     # NE filter blocks domains/apps
   │  ├─ exec-deny.spec.ts           # Endpoint Security denies blocked app launch
   │  └─ usb-presence.spec.ts
   ├─ helpers/
   │  ├─ mockService.ts              # in-proc fake service implementing the protocol
   │  └─ harness.ts                  # spins the real service for native suites
   └─ fixtures/
      ├─ policies.json
      └─ schedules.json
```

---

## 15. File-by-file reference

### Root

| File | Responsibility |
|---|---|
| `package.json` | Defines pnpm workspaces and the top-level `dev`/`build:*`/`test:*` scripts that drive everything. |
| `pnpm-workspace.yaml` | Lists `apps/*`, `packages/*` as workspace members. |
| `tsconfig.base.json` | Shared compiler options + path aliases (`@shared/*`, `@core/*`). |
| `.env*` | Environment config with the precedence described in §11. `.env.example` documents every var; `.env.local` is gitignored. |
| `electron-builder.yml` | Packaging config: Win NSIS + Mac pkg/dmg targets, signing identities, which `resources/bin/*` to embed, installer hooks. |
| `dev-app-update.yml` | Points electron-updater at a local feed for testing updates without publishing. |

### `apps/desktop` — main process

| File | Responsibility |
|---|---|
| `electron.vite.config.ts` | Three build targets (main/preload/renderer); injects validated env via `loadEnv`/`define`; sets up aliases and the renderer's `VITE_` exposure. |
| `src/main/index.ts` | App entry: enforces single instance, registers the `focuslock://` protocol, creates the window and tray, connects the service client, starts the updater. |
| `src/main/window.ts` | Creates the `BrowserWindow` (secure defaults: contextIsolation on, nodeIntegration off), handles deep links (billing return). |
| `src/main/tray.ts` | System tray; subscribes to `keyPresenceChanged` and swaps `tray-green/red.png`; quick focus toggle from the tray. |
| `src/main/config.ts` | Produces the single typed `config` object from validated env; everything imports config from here, never `process.env`. |
| `src/main/logging.ts` | `electron-log` setup (file + console), shared logger. |
| `src/main/updater.ts` | electron-updater: check, download, notify, restart; reads `UPDATE_FEED_URL`. |
| `src/main/ipc/channels.ts` | String constants for renderer↔main channels (no magic strings). |
| `src/main/ipc/handlers.ts` | `ipcMain.handle` implementations the preload calls; they translate UI intents into service RPCs and auth calls. |
| `src/main/service/client.ts` | The NDJSON-RPC client: connects to the pipe/socket, sends requests, dispatches pushed events to subscribers (tray, renderer). Reconnects if the service restarts. |
| `src/main/service/protocol.ts` | Re-exports the shared protocol types so the client is fully typed. |
| `src/main/service/installer.ts` | Ensures the privileged service is installed and current; runs the elevated install/repair/upgrade when versions differ. |
| `src/main/auth/supabase.ts` | Creates the `supabase-js` client from config; sign-in/out, session refresh. |
| `src/main/auth/session.ts` | Persists/loads the session via `safeStorage` (DPAPI/Keychain). |
| `src/main/auth/subscription.ts` | Calls the edge function to verify Stripe entitlement; caches with offline grace. |

### `apps/desktop` — preload & renderer

| File | Responsibility |
|---|---|
| `src/preload/index.ts` | The security boundary. Via `contextBridge` it exposes a small, typed `window.api` (e.g. `getState`, `setPolicy`, `enableFocus`, `onKeyPresence`) and nothing else. No Node access leaks to the UI. |
| `renderer/main.tsx` / `App.tsx` | React root + routing/layout. |
| `renderer/lib/bridge.ts` | Typed hooks over `window.api`, including subscriptions to pushed events that feed the store. |
| `renderer/store/useFocusStore.ts` | zustand store that mirrors service state (focus, policy, schedule, key presence) so the whole UI reacts to one source. |
| `renderer/pages/Dashboard.tsx` | The home screen: big focus toggle, `UsbIndicator`, current mode/schedule status. |
| `renderer/pages/Blocklists.tsx` | Mode switch (blacklist/whitelist/block-all) + domain and app list editors. |
| `renderer/pages/Schedule.tsx` | Weekly schedule editor incl. the `locked` ("no key escape") toggle per window. |
| `renderer/pages/Keys.tsx` | USB pairing: list removable drives, pair, view paired keys, unpair (key-gated). |
| `renderer/pages/Account.tsx` | Sign in/out, subscription status, "Manage billing" → opens `PAYMENT_URL` externally. |
| `renderer/pages/Settings.tsx` | Prefs, update channel, about/version. |
| `renderer/components/UsbIndicator.tsx` | The red/green dot; subscribes to `keyPresenceChanged`; pure presentational. |
| `renderer/components/FocusToggle.tsx` | The on/off control; on disable-without-key shows the "insert your key" state. |
| `renderer/components/ui/*` | shadcn/ui primitives for the sleek look. |

### `packages/shared` & `packages/core`

| File | Responsibility |
|---|---|
| `shared/src/protocol.ts` | The authoritative RPC request/response type definitions (§6). |
| `shared/src/events.ts` | Pushed-event type definitions. |
| `shared/src/policy.ts` / `schedule.ts` | Data models for policy and schedule. |
| `shared/src/constants.ts` | Pipe/socket names, deep-link scheme, protocol version. |
| `core/src/scheduleEngine.ts` | Pure function: given a schedule + current time → desired focus state. Unit-tested; mirrored in native. |
| `core/src/policyNormalize.ts` | Pure validation/normalization of user policy into enforcement form. |
| `core/src/pairing.ts` | Pure crypto helpers: generate secret, salted hash, verify. |

### `native/windows` (Rust)

| File | Responsibility |
|---|---|
| `src/main.rs` | Service Control Manager dispatch entry point. |
| `src/service.rs` | Service start/stop/lifecycle, recovery configuration, restrictive DACL. |
| `src/ipc.rs` | Named-pipe NDJSON-RPC server; routes requests; pushes events. |
| `src/state.rs` | Authoritative state + persistence to the protected store. |
| `src/secure_store.rs` | DPAPI-encrypted at-rest store for paired serials + secret hashes. |
| `src/usb.rs` | `WM_DEVICECHANGE` listener + SetupAPI/CfgMgr32 enumeration; safety poll. |
| `src/pairing.rs` | Decides whether a currently-connected device satisfies a paired key (serial + key-file secret). |
| `src/schedule.rs` | Timer that evaluates the schedule and flips focus. |
| `src/enforce/mod.rs` | The `Enforcer` trait: `apply(policy, focusActive)`. |
| `src/enforce/wfp.rs` | Installs/removes WFP filters (persistent + boot-time). |
| `src/enforce/dns.rs` | Local DNS sinkhole/forwarder; DoH/DoT bypass blocking. |
| `src/enforce/apps.rs` | Process-creation monitor + terminate on match. |
| `installer/service-install.rs` | Tiny elevated CLI invoked at install/update to create/configure/recover/remove the service. |
| `installer/nsis-include.nsh` | NSIS hooks: register+start service on install; guard the uninstall path (§9). |

### `native/macos` (Swift)

| File | Responsibility |
|---|---|
| `project.yml` | XcodeGen spec that generates the Xcode project (keeps project config in version-controllable YAML). |
| `FocusLock.entitlements` | Requests network-extension + endpoint-security entitlements + app group for daemon↔extension sharing. |
| `FocusLockDaemon/main.swift` | Daemon entry: load state, start IPC + USB + schedule + app blocker. |
| `FocusLockDaemon/IPCServer.swift` | Unix-socket/XPC NDJSON-RPC server. |
| `FocusLockDaemon/State.swift` | Authoritative state + persistence. |
| `FocusLockDaemon/SecureStore.swift` | Keychain-backed paired key store. |
| `FocusLockDaemon/USBMonitor.swift` | IOKit + DiskArbitration presence detection. |
| `FocusLockDaemon/Pairing.swift` | Device-matches-paired-key check. |
| `FocusLockDaemon/ScheduleEngine.swift` | Timer-driven schedule enforcement. |
| `FocusLockDaemon/AppBlocker.swift` | Endpoint Security `AUTH_EXEC` deny for blocked apps. |
| `FocusLockFilter/FilterDataProvider.swift` | `NEFilterDataProvider`: the actual domain/app/all-internet enforcement. |
| `FocusLockFilter/Info.plist` | Network Extension declaration. |
| `Resources/com.focuslock.daemon.plist` | LaunchDaemon plist with `RunAtLoad` + `KeepAlive`. |

### `scripts/`, `config/`, `tests/`

Covered inline above (§13, §11, §16). Each script does exactly one orchestration job; the
config pair (`schema.ts` + `load.ts`) is the only place env is parsed; tests are split into
the three required categories with shared `helpers/` and `fixtures/`.

---

## 16. Testing strategy (3 categories)

The three categories map cleanly onto where each kind of code can actually run.

### Category 1 — Electron tests (`tests/electron/`) — run anywhere, in CI

- **Unit (`unit/`, vitest):** the pure logic — `scheduleEngine`, `policyNormalize`,
  `pairing` crypto, config validation. Fast, deterministic, no OS dependencies. This is where
  the bulk of correctness lives, which is *why* that logic is pulled into `packages/core`.
- **E2E (`e2e/`, playwright-electron):** drives the real Electron UI against a **mock
  service** (`helpers/mockService.ts`) that implements the protocol in-process. Verifies
  flows: toggling focus, editing blocklists, the pairing UI, and that the red/green indicator
  reacts to a (mocked) `keyPresenceChanged`. No privileges or real blocking needed.

### Category 2 — Windows tests (`tests/windows/`) — run on a Windows host

These need a real Windows machine (CI runner or VM) because they exercise the privileged
service and OS APIs:

- `service-lifecycle` — install the service, kill it, confirm SCM auto-restart + recovery,
  confirm a non-admin can't stop it.
- `wfp-blocking` — with focus on, a blocked domain is unreachable; **editing `hosts` changes
  nothing**; allowed domains still work.
- `dns-bypass` — DoH/DoT bypass attempts are blocked.
- `app-blocking` — launching a blocked executable results in termination.
- `usb-presence` — pair a (real or virtual) drive; plug/unplug flips presence and the disable
  gate behaves (refuses without key, allows with key).

### Category 3 — Mac tests (`tests/mac/`) — run on a macOS host

Need a real Mac (with the entitlements provisioned) because of the Network/System Extension
and Endpoint Security:

- `daemon-lifecycle` — LaunchDaemon `KeepAlive` restarts the daemon after a kill.
- `filter-blocking` — the NE content filter blocks domains/apps per policy.
- `exec-deny` — Endpoint Security denies launching a blocked app.
- `usb-presence` — same presence + disable-gate behavior as Windows.

**Test runner wiring:** `scripts/run-platform-tests.mjs` picks the right suite by `--target`
and spins the **real** service via `helpers/harness.ts`. CI: category 1 runs on every push;
categories 2 and 3 run on Windows and macOS runners respectively (gated, since they need
elevation/entitlements).

---

## 17. Tech stack summary

| Concern | Choice | Why |
|---|---|---|
| Shell | **Electron** | Cross-platform UI, mature, auto-update story. |
| Build/dev | **electron-vite** + **electron-builder** + **electron-updater** | Fast HMR, clean env handling, signed installers, auto-update. |
| Language (app) | **TypeScript** everywhere | One language across main/preload/renderer/shared/core. |
| UI | **React + Tailwind + shadcn/ui** (+ framer-motion) | Sleek, fast to build, consistent components. |
| UI state | **zustand** | Tiny, mirrors service state without boilerplate. |
| Windows service | **Rust** (`windows` crate) | Memory-safe SYSTEM process; full WFP/SetupAPI/SCM/DPAPI access. |
| macOS service | **Swift** (NetworkExtension, EndpointSecurity, IOKit) | Required toolchain for the strong enforcement entitlements. |
| Config validation | **Zod** | Fail-fast typed config from `.env`. |
| Auth | **Supabase** (`supabase-js` in main) | Simple managed auth; tokens kept out of the renderer. |
| Payments | **Stripe** via your hosted page + **Supabase Edge Function** | Secret key stays server-side; client only redirects + verifies entitlement. |
| Tests | **vitest** + **playwright-electron** + native test harness | Maps to the three required categories. |

---

## 18. Prerequisites, signing & entitlements

These are the real-world gating dependencies — surface them early, they have lead time.

- **Windows code signing (Authenticode):** required for auto-update and to avoid SmartScreen
  warnings. An OV cert works but EV reduces SmartScreen friction. Needed before any
  distributable build.
- **macOS Developer ID + notarization:** required for distribution and auto-update.
- **macOS managed entitlements (the long pole):**
  - `com.apple.developer.networking.networkextension` (content-filter-provider) — request
    via your Apple Developer account; Apple must approve.
  - `com.apple.developer.endpoint-security.client` — also Apple-approved, with a written
    justification. **Start this request early**; approval is not instant.
- **Driver signing (only if you later add a Windows kernel minifilter for pre-exec app
  blocking):** EV cert + Microsoft attestation signing. Not needed for v1's user-mode
  approach — explicitly deferred.
- **Supabase project** (cloud) + local stack (`supabase start`) for dev, and a **Stripe**
  account (test + live) with one Edge Function holding the secret key.

---

## 19. Suggested build phases

A pragmatic order that gets you a working, testable product fast and defers the slow/expensive
bits:

1. **Skeleton:** monorepo, config system, Electron app with the UI shell and the mock
   service. Category-1 tests green. (No real blocking yet — but the whole app "works.")
2. **Windows service v1:** IPC, state, persistence, USB pairing + presence, WFP domain
   blocking + local DNS, user-mode app blocking, persistence/recovery. Category-2 tests green.
   This is your first genuinely-enforcing Windows build.
3. **Auth + payments:** Supabase sign-in, the edge function, entitlement gating, the billing
   redirect + deep-link return.
4. **Auto-update + signing:** Authenticode, electron-updater, the elevated service-upgrade
   path. First real shippable Windows build.
5. **macOS port:** request entitlements early (phase 1!), then build the Swift daemon, NE
   filter, ES app blocking, notarization. Category-3 tests green.
6. **Hardening (optional):** DoH endpoint list maintenance, VPN/TUN blocking setting,
   Protected Process Light / kernel minifilter if you decide the threat model warrants it.

---

### Appendix: one-paragraph mental model

> The Electron app is a **remote control**. The privileged service is the **lock**. The USB
> key is the **physical key to the lock**. The remote control can ask the lock to open, but
> the lock itself checks for the physical key before opening — so losing or killing the remote
> changes nothing, and editing files the lock doesn't even read (like `hosts`) changes nothing.
> Everything else — schedules, blocklists, modes, auth, payments, updates — is plumbing around
> that one relationship.
