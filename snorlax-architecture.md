# Talysman — Architecture & Build Walkthrough

> A cross-platform distraction blocker built on Electron, with privileged Rust services for
> Windows, Linux, and macOS, gated by a paired USB key.
>
> This document records both the implemented architecture and explicitly labelled future
> hardening. Platform READMEs are the source of truth for backend-specific operational details.

This document is the architectural overview and design history. The root README and platform
READMEs are the maintained operational indexes.

Codename used throughout: **Talysman**. Rename freely (`talysman` → your brand).

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
19. [Current status and roadmap](#19-current-status-and-roadmap)

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
| Kill the service process | Service is configured to auto-restart (Windows SCM recovery actions / launchd `KeepAlive`). The packet-engine (WinDivert) layers die with the process, but the **persistent Windows Firewall rules** (DoT/DoH-IP/QUIC) remain in force in the ~1s gap before the SCM restarts the service and re-arms the engines. |
| Edit local DNS configuration | Windows intercepts DNS with WinDivert; Linux combines nftables with dnsmasq when available; macOS currently uses `pf` plus a managed `/etc/hosts` block. The browser extension is the hostname-aware layer across all platforms. |
| Change DNS server | Windows intercepts port 53 with WinDivert and blocks known encrypted-DNS paths; Linux/macOS rely on their packet rules, DNS helpers, and browser extension. Coverage varies by platform and must be tested explicitly. |
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
- **macOS entitlements.** The current backend is an entitlement-free Rust LaunchDaemon using
  `pf`, `/etc/hosts`, and process termination. Stronger Network Extension content filtering and
  Endpoint Security execution denial remain future work and require Apple-granted managed
  entitlements — see §18.

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
│   ┌──────────────────────── Talysman Service ───────────────────────┐  │
│   │                                                                   │  │
│   │   IPC server  ──►  State (authoritative)  ──►  Enforcement       │  │
│   │                     - focus on/off              ┌───────────────┐ │  │
│   │   USB monitor ──►   - active policy             │ Windows:      │ │  │
│   │   (polling)         - schedule                  │  WinDivert    │ │  │
│   │                     - paired key set            │  DNS+IP drop  │ │  │
│   │   Schedule timer ─► (flips focus on/off)        │  fw backstop  │ │  │
│   │                                                 │  proc monitor │ │  │
│   │                                                 ├───────────────┤ │  │
│   │   Secure store ──►  paired ids + secret hashes  │ macOS:        │ │  │
│   │   (protected data directory)                    │  pf + hosts   │ │  │
│   │                                                 │  proc monitor │ │  │
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
- `native/linux` and `native/macos` — Rust services using nftables/dnsmasq and
  `pf`/`/etc/hosts`, respectively.
- `native/protocol` — the language-neutral RPC schema both sides implement.
- `scripts`, `config`, `tests` — orchestration, config loading, and the three test suites.

---

## 4. The privileged service (enforcement layer)

The service is one long-running privileged process per OS. It is small, boring, and
defensive. Its responsibilities:

1. Host the **IPC server** the UI connects to.
2. Hold **authoritative state**: `{ focusActive, policy, schedule, pairedKeys }`, persisted
   to a protected on-disk store so it survives restarts.
3. Poll removable media and broadcast key-presence changes.
4. Run the **schedule timer** that flips focus on/off at window boundaries.
5. **Enforce** the active policy through the OS network/process APIs.
6. **Guard the disable path**: independently verify a paired key is physically present
   before honoring any `disableFocus`.

### 4.1 Windows enforcement

Built in **Rust** with the [`windows`](https://crates.io/crates/windows) crate plus
**WinDivert 2.2**
packet-capture driver. Rust gives us memory safety in a SYSTEM-level process and first-class
bindings to every Win32 API we need.

> **Why WinDivert, not a hand-written WFP callout?** WinDivert ships an already-signed kernel
> driver, so Talysman can intercept DNS and drop resolver-fed destination IPs while keeping its
> policy logic in user mode. The cost is that WinDivert enforcement only holds while the service
> process runs; Windows Firewall rules provide a narrower persistent backstop.

There is **no** loopback resolver, no `hosts` edits, and no rewriting of the adapter's DNS
settings. We filter by destination **port** at the packet layer, which also catches apps that
hard-code a resolver IP — the gap an adapter-DNS approach leaves open.

**Current website/network blocking.** The service intercepts DNS, maintains a resolver-fed
blocked/allowed IP bank, installs a mode-aware WinDivert drop filter, and adds Windows Firewall
backstops for DoT, known DoH resolver IPs, and QUIC. The browser extension supplies request-level
hostname coverage.

#### Historical SNI/taint design (not implemented)

The detailed design below was an earlier proposal. The current tree has no `sni.rs`,
`observations.rs`, flow-to-SNI map, or taint/exoneration engine; do not use this subsection to
describe shipped behavior.

Four proposed cooperating mechanisms, ordered from "names" to "the hostname actually on the wire":

1. **Blocklist expansion (`enforce::properties`).** Many sites serve content from sibling/CDN
   domains whose names don't match the parent (Reddit → `redditmedia.com`, `redditstatic.com`;
   YouTube → `googlevideo.com`, `ytimg.com`). A curated `PROPERTY_GROUPS` table expands a blocked
   canonical to its siblings. The expansion is applied to the *enforced* copy of the policy only
   (`EnforceShared`), so the user's authored/persisted list stays clean; both the DNS and SNI
   layers below consult the expanded set. This was intended to address CDN-sibling and
   HTTP/2-coalescing leaks.

2. **DNS interception — always-on packet engine (`divert::run_engine`).** One WinDivert
   NETWORK-layer handle runs for the whole service lifetime and self-gates on `focusActive`. Its
   filter captures outbound UDP/TCP **53** and **853**. While focus is active it:
   - parses the query name and, for a blocked name or a known DoH-endpoint/canary host
     (`policy_match::is_host_blocked` / `DOH_BYPASS_HOSTS`), **injects a spoofed `NXDOMAIN`**
     reply and drops the original query — no upstream lookup happens;
   - **drops DNS-over-TLS/QUIC** on port 853;
   - **suppresses ECH bootstrap**: answers `HTTPS`/`SVCB` resource-record queries (type 65/64)
     with **NODATA** while focused, so a browser can't fetch an Encrypted-ClientHello config and
     hide its SNI from layer 3. (Trade-off: no ECH / no HTTP-3 hints while focused.)

   Whitelist and block-all modes fall out of the same predicate: `is_host_blocked` returns true
   for any non-allowed (resp. every) name, so the engine sinkholes everything outside the
   allow-list.

3. **SNI inspection — the correctness layer (`divert::run_sni_engine`).** DNS blocking is a proxy
   for the real goal and is leaky (coalesced sockets make no query; cached/hardcoded IPs skip
   DNS). This layer enforces on the hostname the browser literally puts on the wire — the **SNI**
   in the cleartext TLS ClientHello — so it's immune to CDN sharing, hardcoded IPs, and stale
   DNS. It is an **always-on** WinDivert handle whose filter tracks focus: while unfocused it is
   **record-only** with the deliberately narrow filter

   ```
   outbound and tcp.DstPort == 443 and tcp.PayloadLength > 0
     and tcp.Payload[0] == 0x16 and tcp.Payload[1] == 0x03
   ```

   (one packet per new TLS connection), and while focused it widens to also capture UDP 443 for
   the QUIC drop. The `0x16 0x03` payload match is evaluated **in the kernel**, so only TLS
   *handshake* packets are copied to user space — bulk application data (`0x17…`, i.e.
   downloads/streaming/uploads) never leaves the kernel and steady-state throughput is untouched.
   For each captured ClientHello we extract the SNI (`enforce::sni`) and record the flow→SNI
   mapping *and* the host→IP mapping in the persisted antibody store (`enforce::observations`) —
   *always*, even unfocused, so a later focus-on knows the hostname behind every already-open
   socket and can pre-arm the suspect set against it (3b, below). While focused, if the host is
   blocked we **drop the ClientHello, inject an inbound TCP RST** to the client (sequence number
   taken from the observed ack so the stack accepts it), and **taint the destination IP** (below);
   if it is allowed we `note_allowed` + `untaint` it (exoneration). The connection fails fast
   instead of timing out. This layer also enforces whitelist/block-all on 443.

3b. **Pre-armed suspect-IP drop — the pooled-socket killer (`divert::run_taint_drop`).** This is
   the **IP-first** enforcement point (guilty until proven innocent). A pooled/coalesced/opaque
   HTTP/2-3 socket opened before a block took effect sends no new ClientHello, so SNI inspection
   never fires on it. Borrowing a stateless-drop approach from the Linux sibling `focusd`, the
   suspect-IP set is **pre-armed at focus-on**
   from the persisted antibody store (`enforce::observations`), the active resolver
   (`enforce::resolve`), and the recorded in-session flows (`seed_taints_from_flows`) — so a
   destination associated with a blocked domain is already in the set before its first packet. A
   dedicated WinDivert handle opened with the **DROP flag** silently discards outbound 443
   **application-data** (`tcp.PayloadLength > 0` and not a `0x16 0x03` handshake record) + all QUIC
   (UDP 443) to in-scope destinations — no recv loop, zero per-packet user-space cost. SYN/ACK and
   the cleartext ClientHello are **let through**, so the SNI engine (3, above) still adjudicates
   every *new* connection: an allowed SNI → `note_allowed` + `untaint` (the IP recovers on its next
   handshake); a blocked SNI → RST + `taint`. A pooled socket (no handshake) can't get a request
   out and dies. The filter is **mode-aware** (`build_drop_filter`): **blacklist** drops to the
   tainted set; **whitelist** drops to everything *not* in the durable **clean** allow-exception
   set; **block-all** drops all 443. Precision guards against CDN over-block: an IP recently seen
   serving an *allowed* SNI is never tainted, taints age out after a 5-minute TTL, and a
   wrongly-scoped shared IP self-heals via the let-through handshake. All session sets clear on
   focus-off; the durable antibody store on disk is retained.

4. **QUIC / HTTP-3.** QUIC (UDP 443) hides request details from packet inspection and can keep
   pooled sessions alive across a focus transition. For now we **block outbound UDP 443** while
   focused, forcing browsers to fall back to TCP where the DNS sinkhole, destination-IP drop, and
   extension request rules are the intended enforcement path.

**Persistent firewall backstop (`enforce::wfp`).** The WinDivert layers above die with the
process. As a kill-survival backstop we install **Windows Firewall** rules (via `netsh
advfirewall`, a front-end to WFP — no callout driver) when focus turns on, removed when it turns
off:

- block outbound **853** (DoT/DoQ), TCP + UDP;
- block outbound **443 to a maintained list of public DoH resolver IPs** (closes the
  hardcoded-IP DoH path);
- block outbound **UDP 443** (the QUIC force-to-TCP rule above).

These are ordinary firewall rules, so they **persist if the service is killed** until focus is
cleared, while the SCM restarts the service (~1s) to re-arm the WinDivert layers.

**Browser extension blocking (`enforce::extension_policy`, `talysman-natmsg.exe`).** Browser
request-layer blocking lives in the user-installed store extension for Chromium variants and
Firefox. The native service registers the local messaging host but does not force-install or lock
the extension through enterprise browser policy.
The service sends live `{active, mode, domains}` state over native messaging; the extension applies
declarativeNetRequest rules above TLS and clears them when focus turns off. We no longer write
Chromium enterprise `URLBlocklist` / `URLAllowlist` policies; extension install only removes
legacy policy keys from older builds.

**Warm resolver (`enforce::resolve`).** The resolver is a hand-rolled UDP DNS client that resolves
the policy's expanded domains (blocklist in blacklist mode, allowlist in whitelist mode) through
the OS-configured resolvers first, then public fallbacks. It runs on startup, on policy/focus kicks,
and a 5-minute ticker **whether focus is on or off**, replacing the blocked/allowed IP bank
wholesale like `focusd`'s atomic nftables set swap. It binds a **fixed local source port** that
`ENGINE_FILTER` excludes, so our own lookups bypass the DNS sinkhole.

> **Connection reset — removed.** Earlier builds tore down already-open sockets with an RST burst
> (deterministic `SetTcpEntry(DELETE_TCB)` for v4, an RFC-5961 challenge-ACK SYN-probe trick for
> v6) on a signal from the core. The pre-armed stateless drop (3b) replaces that find-and-reset
> race: an already-open socket to a suspect destination simply can't send application-data, so
> there is nothing to "reset." The reset worker, its SYN probes, the `SetTcpEntry` kill, and the
> per-4-tuple drop were all deleted.

**App blocking — process termination (`enforce::apps`).** A ~1s poll of the process list
`TerminateProcess`es any image-name match on the blocked-app list while focused. *Pre-execution*
denial (an ETW/WMI process-create hook, or a minifilter) is a future hardening step; polling is
simple and robust for v1.

**Deferred hardening (all require their own driver signing, hence out of v1):** a kernel-WFP
**connect-redirect callout** (transparent redirect and kill-resistant, flow-level filtering that
survives the process being killed — the only thing that closes the "raw IP-literal with no SNI"
gap in block-all mode), raw `FWPM_FILTER_FLAG_PERSISTENT` ALE_AUTH_CONNECT filters, and QUIC
Initial parsing.

**Persistence & self-protection:**

- Installed as a Windows Service, `SERVICE_AUTO_START`, account `LocalSystem`.
- Recovery configured: `sc failure ... actions= restart/1000/restart/1000/restart/1000`
  so the SCM restarts it on crash/kill.
- Service security descriptor (DACL) denies `SERVICE_STOP`/`SERVICE_DELETE` to non-admins.
- (Advanced/optional) Protected Process Light to resist admin kills — requires special
  EV/attestation code-signing; out of scope for v1.

### 4.2 macOS enforcement

The implemented backend is a **Rust LaunchDaemon**, deliberately avoiding managed Apple
entitlements for the first cut:

- `pf` rules use a resolver-fed IP bank for blacklist mode and default-deny web egress in
  whitelist/block-all modes.
- A marker-delimited `/etc/hosts` block adds DNS-level blacklist coverage.
- App blocking polls running processes and terminates matches.
- USB volumes are discovered under `/Volumes`; the service uses the volume UUID plus key-file
  secret where available.
- `/Library/LaunchDaemons/app.talysman.svc.plist` uses `RunAtLoad` and `KeepAlive`.

This is weaker than the proposed Apple-native design. A future System Extension with
`NEFilterDataProvider` and an Endpoint Security `AUTH_EXEC` client would improve hostname-aware
network filtering and pre-exec app denial, but both require Apple-managed entitlements. See
[native/macos/README.md](./native/macos/README.md) for current behavior and validation gaps.

### 4.3 Cross-platform contract

All three native implementations expose the **same RPC surface** (§6) and consume the same
normalized policy (§7). Platform modules differ internally, while the UI stays platform-agnostic.

---

## 5. USB pairing & presence detection

### 5.1 What "a paired key" is

We bind to two things for defense in depth:

1. **Device identity** — the `(VID, PID, serialNumber)` tuple of the USB device. This is
   what we poll/enumerate to answer "is the key plugged in right now?" cheaply.
2. **A secret key file** — at pairing time we generate a random 256-bit secret, write it to
   a file on the drive (e.g. `/.talysman/key.bin`), and store a salted hash of the secret
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
3. Service (privileged): reads the platform's available volume identifier, generates a random
   secret, writes `.talysman/key.bin` to the drive, and stores the identifier plus a salted secret
   hash in its root/SYSTEM-owned data directory.
4. UI confirms; the new key appears in the list.

Adding a key is currently not gated when keys already exist. That must be corrected before the
physical-key boundary is considered hardened: once a key exists (and especially while focus is
active), `pairKey` should require an already paired key to be present.

### 5.3 Presence detection

The current services re-enumerate removable media every three seconds. When presence changes, the
service pushes a `keyPresenceChanged` event to the Electron app. Event-driven OS notifications are
a future latency/efficiency improvement.

When presence changes, the service **pushes** a `keyPresenceChanged` event to the UI over the
IPC channel. The UI never polls the hardware itself — it just renders whatever the service
last told it. The tray icon and the in-app `UsbIndicator` both subscribe to this one event.

```
poll tick ──► service re-enumerates ──► matches a pairedKey?
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
- Windows: named pipe `\\.\pipe\talysman`.
- Linux: Unix-domain socket `/run/talysman/talysman.sock`.
- macOS: Unix-domain socket `/var/run/talysman/talysman.sock`.

**Wire format:** newline-delimited JSON (NDJSON). Each line is one message. Two message
kinds: request/response (RPC) and server-pushed events. The contract is defined **once** in
`packages/shared/src/protocol.ts` (TypeScript types) and mirrored by a language-neutral
schema in `native/protocol/` that the Rust servers conform to.

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

**Security at the boundary:** `disableFocus` and `unpairKey` cause the service to physically
re-verify a paired key. However, the current `pairKey` gap described in §5.2 means this is not yet
a complete guarantee. Socket/pipe access should also be narrowed to the intended desktop user
rather than every local interactive user.

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
- **macOS:** the current LaunchDaemon controller is an administrative operation. It does not yet
  have the proposed System Extension removal protections.

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

1. **Purchase:** the Account/Plans page calls `POST /api/desktop/checkout` on the Next.js web
   app, which returns a Stripe Checkout URL the app opens in the external browser
   (`shell.openExternal`). After payment, Stripe redirects back to a deep link
   (`talysman://billing/success`) that re-focuses the app and refreshes entitlement.
2. **Verification:** the app calls the **Next.js web backend** (`GET /api/desktop/entitlement`)
   which holds the Stripe *secret* key and reads the user's subscription (kept in sync by the
   Stripe webhook). The client "pings Stripe" *through* this backend — never directly with a
   secret. Subscription state lives in Supabase guarded by RLS.
3. **Entitlement check:** `src/main/auth/subscription.ts` reads that entitlement on launch
   and caches it locally; while signed in it keeps the last-known entitlement through network
   outages so a flaky network doesn't lock a paying user out — and, importantly, so a lapse
   can't suddenly *unblock* someone mid-focus-session.

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
| `API_BASE_URL` (your Next.js web origin) | public | main |
| `UPDATE_FEED_URL` | public | updater |
| `STRIPE_SECRET_KEY` | **SECRET — never in the app** | web backend only |

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
- Root desktop defaults are described by `config/schema.ts`; production build validation also
  happens in `scripts/build.mjs`. The web app has its own server/public Zod schemas in
  `apps/web/src/lib/config.ts`.
- Application modules use the typed config objects. Bootstrap modules that bundlers must analyze
  and small key-loading helpers use literal `process.env` reads deliberately.

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

`pnpm build:win`, `pnpm build:linux`, and `pnpm build:mac` build the target native service, browser
extension artifacts, Electron bundles, and the platform package in one command.

### The orchestration (`scripts/build.mjs`)

```
1. Load + validate target config and release-version consistency.
2. Build the target Rust binaries and stage them in `apps/desktop/resources/bin/current/`.
3. Build and audit the browser extension (including Safari artifacts on macOS).
4. Build the Electron main/preload/renderer bundles with electron-vite.
5. Package with electron-builder:
      - Windows: NSIS installer + LocalSystem service hook.
      - Linux: `.deb` with systemd hooks; AppImage is retained for the local Nix flow.
      - macOS: signed/notarized DMG + ZIP with the Rust LaunchDaemon controller and Safari
        extension.
```

### Dev loop (`scripts/dev.mjs`)

- Generates local env, starts Supabase, starts Stripe webhook forwarding, starts Next.js, then
  launches electron-vite.
- The Electron development build attempts the dev service pipe and falls back to an in-process mock
  when it is unavailable.

### Top-level scripts (root `package.json`)

```jsonc
{
  "scripts": {
    "dev":        "node scripts/dev.mjs",
    "build:win":  "cross-env APP_ENV=production node scripts/build.mjs --target win",
    "build:mac":  "cross-env APP_ENV=production node scripts/build.mjs --target mac",
    "build:linux": "cross-env APP_ENV=production node scripts/build.mjs --target linux",
    "build:dev":  "cross-env APP_ENV=development node scripts/build.mjs --target linux",
    "test":       "vitest run",
    "web:test":   "pnpm --filter @talysman/web test",
    "lint":       "eslint . && pnpm --filter @talysman/web lint",
    "typecheck":  "tsc -b"
  }
}
```

---

## 14. Historical proposed directory layout

The tree below is retained as design history and is not the current repository map. In particular,
it predates `apps/web`, `apps/extension`, the Linux Rust service, and the current macOS Rust
LaunchDaemon. Use the maintained map in [README.md](./README.md) plus `rg --files` when navigating
the repository.

```
talysman/
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
│     │  │  ├─ window.ts             # BrowserWindow + deep-link (talysman://) handling
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
│     │  │     ├─ subscription.ts    # entitlement check via /api/desktop/entitlement + offline grace
│     │  │     └─ billing.ts         # checkout/portal via /api/desktop/{checkout,portal}
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
│     │     ├─ win/                   # talysman-svc.exe (+ deps) — populated by build
│     │     └─ mac/                   # TalysmanDaemon, *.systemextension — populated by build
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
│  │  │     ├─ mod.rs                # EnforceShared: pre-armed taint/clean sets; mode-aware seeding
│  │  │     ├─ divert.rs             # WinDivert engines: DNS sinkhole + 443 SNI exoneration + pre-armed drop
│  │  │     ├─ dns.rs                # pure DNS wire helpers (QNAME/QTYPE, NXDOMAIN/NODATA)
│  │  │     ├─ sni.rs                # pure TLS ClientHello → SNI extraction
│  │  │     ├─ resolve.rs            # active UDP DNS resolver (fixed src port; pinned upstreams)
│  │  │     ├─ observations.rs       # persisted host→IP antibody store (observations.json)
│  │  │     ├─ properties.rs         # multi-domain property groups + blocklist expansion
│  │  │     ├─ wfp.rs                # persistent firewall backstop (DoT/DoH-IP/QUIC via netsh)
│  │  │     └─ apps.rs               # process-list poll + TerminateProcess on match
│  │  └─ installer/
│  │     ├─ service-install.rs       # tiny elevated CLI: create/configure/recover/remove svc
│  │     └─ nsis-include.nsh         # NSIS hooks: install/start svc; guard uninstall
│  └─ macos/                         # ===== macOS daemon + system extension (Swift) =====
│     ├─ project.yml                 # XcodeGen spec (generates the .xcodeproj)
│     ├─ Talysman.entitlements      # network-extension + endpoint-security + app groups
│     ├─ TalysmanDaemon/            # the root LaunchDaemon
│     │  ├─ main.swift               # entry; loads state; starts IPC + monitors
│     │  ├─ IPCServer.swift          # unix-socket / XPC NDJSON-RPC server
│     │  ├─ State.swift              # authoritative state + persistence
│     │  ├─ SecureStore.swift        # Keychain-backed paired keys
│     │  ├─ USBMonitor.swift         # IOKit + DiskArbitration presence
│     │  ├─ Pairing.swift            # verify present device matches a paired key
│     │  ├─ ScheduleEngine.swift     # timer-driven schedule enforcement
│     │  └─ AppBlocker.swift         # Endpoint Security AUTH_EXEC deny
│     ├─ TalysmanFilter/            # the Network Extension (System Extension)
│     │  ├─ FilterDataProvider.swift # NEFilterDataProvider: domain/app/all enforcement
│     │  └─ Info.plist
│     └─ Resources/
│        └─ com.talysman.daemon.plist  # LaunchDaemon plist (KeepAlive, RunAtLoad)
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

## 15. Historical file-by-file reference

This section accompanies the proposed tree in §14 and should not be used as an operational
inventory. The platform READMEs and source-level module comments describe the implemented files.

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
| `src/main/index.ts` | App entry: enforces single instance, registers the `talysman://` protocol, creates the window and tray, connects the service client, starts the updater. |
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
| `src/main/auth/subscription.ts` | Calls `GET /api/desktop/entitlement` on the web backend to verify Stripe entitlement; caches with offline grace. |
| `src/main/auth/billing.ts` | Calls `POST /api/desktop/checkout` and `/api/desktop/portal`, opening the returned Stripe URL in the browser. |

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
| `src/enforce/mod.rs` | `EnforceShared` (live policy/focus state plus resolver-fed blocked/allowed IP banks); property expansion; `apply_network` toggles the firewall backstop. |
| `src/enforce/divert.rs` | WinDivert packet engines: always-on DNS/DoT engine (NXDOMAIN injection, DoT drop, ECH/HTTPS-RR suppression, resolver-src-port exemption) plus the focus-gated DROP-flag destination-IP handle (`build_drop_filter`). |
| `src/enforce/resolve.rs` | Warm UDP DNS resolver bound to a fixed local source port (sinkhole-exempt); resolves the expanded policy domains at startup, on policy/focus kicks, and every 5 minutes whether focus is on or off. |
| `src/enforce/extension_policy.rs` | Registers the native-messaging host for the user-installed browser extension; clears legacy Chromium URL policy keys from older builds. |
| `src/enforce/dns.rs` | Pure DNS wire helpers (parse QNAME/QTYPE, build NXDOMAIN/NODATA replies) used by the engine. |
| `src/enforce/properties.rs` | Curated multi-domain "property group" table + blocklist expansion (sibling/CDN domains). |
| `src/enforce/wfp.rs` | Installs/removes the persistent Windows-Firewall backstop (DoT 853, DoH resolver IPs, QUIC UDP 443) via `netsh`. |
| `src/enforce/apps.rs` | Process-list poll + `TerminateProcess` on a blocked-app match. |
| `installer/service-install.rs` | Tiny elevated CLI invoked at install/update to create/configure/recover/remove the service. |
| `installer/nsis-include.nsh` | NSIS hooks: register+start service on install; guard the uninstall path (§9). |

### `native/macos` (Swift)

| File | Responsibility |
|---|---|
| `project.yml` | XcodeGen spec that generates the Xcode project (keeps project config in version-controllable YAML). |
| `Talysman.entitlements` | Requests network-extension + endpoint-security entitlements + app group for daemon↔extension sharing. |
| `TalysmanDaemon/main.swift` | Daemon entry: load state, start IPC + USB + schedule + app blocker. |
| `TalysmanDaemon/IPCServer.swift` | Unix-socket/XPC NDJSON-RPC server. |
| `TalysmanDaemon/State.swift` | Authoritative state + persistence. |
| `TalysmanDaemon/SecureStore.swift` | Keychain-backed paired key store. |
| `TalysmanDaemon/USBMonitor.swift` | IOKit + DiskArbitration presence detection. |
| `TalysmanDaemon/Pairing.swift` | Device-matches-paired-key check. |
| `TalysmanDaemon/ScheduleEngine.swift` | Timer-driven schedule enforcement. |
| `TalysmanDaemon/AppBlocker.swift` | Endpoint Security `AUTH_EXEC` deny for blocked apps. |
| `TalysmanFilter/FilterDataProvider.swift` | `NEFilterDataProvider`: the actual domain/app/all-internet enforcement. |
| `TalysmanFilter/Info.plist` | Network Extension declaration. |
| `Resources/com.talysman.daemon.plist` | LaunchDaemon plist with `RunAtLoad` + `KeepAlive`. |

### `scripts/`, `config/`, `tests/`

Covered inline above (§13, §11, §16). Each script does exactly one orchestration job; the
config pair (`schema.ts` + `load.ts`) is the only place env is parsed; tests are split into
the three required categories with shared `helpers/` and `fixtures/`.

---

## 16. Testing strategy (3 categories)

The subsections below are the original target test plan, not a statement that all of those suites
exist. The implemented automated coverage is:

- root Vitest: Electron/shared/core/release unit tests;
- web Vitest: auth, billing, email, download, content, config, and OAuth unit tests;
- Playwright suites for Electron and web under `tests/electron/e2e` and `apps/web/tests/e2e`;
- Rust unit tests in `native/common`, `native/linux`, `native/macos`, and `native/windows`.

See [README.md](./README.md#verification) for current commands. Real clean-host, elevated
enforcement tests on Windows/macOS/Linux remain release gates that are not represented by the root
`pnpm test`.

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
| UI | **React + Tailwind** | Shared Electron UI primitives and responsive web components. |
| UI state | **zustand** | Tiny, mirrors service state without boilerplate. |
| Native services | **Rust** | Windows, Linux, and macOS share the protocol and much of the enforcement model. |
| Config validation | **Zod** | Fail-fast typed config from `.env`. |
| Auth | **Supabase** (`supabase-js` in main) | Simple managed auth; tokens kept out of the renderer. |
| Payments | **Stripe** via the **Next.js web backend** (`/api/desktop/*` + Stripe webhook) | Secret key stays server-side; client only redirects + verifies entitlement. |
| Tests | **Vitest**, **Playwright**, and Rust unit tests | Fast cross-platform coverage plus separate E2E suites. |

---

## 18. Prerequisites, signing & entitlements

These are the real-world gating dependencies — surface them early, they have lead time.

- **Windows code signing (Authenticode):** required for auto-update and to avoid SmartScreen
  warnings. An OV cert works but EV reduces SmartScreen friction. Needed before any
  distributable build.
- **macOS Developer ID + notarization:** required for distribution and auto-update.
- **macOS managed entitlements (future hardening):**
  - `com.apple.developer.networking.networkextension` (content-filter-provider) — request
    via your Apple Developer account; Apple must approve.
  - `com.apple.developer.endpoint-security.client` — also Apple-approved, with a written
    justification. **Start this request early**; approval is not instant.
- **Driver signing (only if you later add a Windows kernel minifilter for pre-exec app
  blocking):** EV cert + Microsoft attestation signing. Not needed for v1's user-mode
  approach — explicitly deferred.
- **Supabase project** (cloud) + local stack (`supabase start`) for dev, and a **Stripe**
  account (test + live). The secret key lives in the Next.js web backend (`/api/desktop/*` +
  the Stripe webhook), never in the desktop app.

---

## 19. Current status and roadmap

Implemented: the Electron shell, all three Rust native backends, browser extension/native
messaging, Supabase auth, Stripe/complimentary entitlements, offline entitlement caching,
auto-update plumbing, and multi-platform release automation.

The next work is hardening rather than another numbered feature phase:

1. Make production service startup fail closed; never substitute the mock service.
2. Gate additional USB-key pairing and narrow local IPC access.
3. Make authoritative-state writes atomic and propagate persistence/enforcement failures.
4. Add clean-host elevated E2E coverage and enforcement-health reporting.
5. Tighten web billing/RLS boundaries and webhook idempotency.
6. Pursue Network Extension/Endpoint Security only if the stronger macOS guarantees justify the
   entitlement and packaging cost.

---

### Appendix: one-paragraph mental model

> The Electron app is a **remote control**. The privileged service is the **lock**. The USB
> key is the **physical key to the lock**. The remote control can ask the lock to open, but the lock
> itself must check the physical key and durably commit its state before acting. The implementation
> is only as strong as that boundary, its local IPC permissions, and the health of each platform's
> enforcement mechanisms.
