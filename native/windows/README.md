# FocusLock Windows service (Rust)

One crate, three binaries (see `Cargo.toml`):

| Binary | Role |
|---|---|
| `focuslock-svc.exe` | The privileged service. SCM-managed (LocalSystem, auto-start). Run `--console` for a foreground dev instance. |
| `focuslock-svcctl.exe` | Elevated install/configure/recover/remove CLI. Generates the recovery code at install. |
| `focuslock-recover.exe` | The killswitch — `--code XXXX-XXXX-XXXX` force-disables focus and tears down enforcement. |
| `focuslock-natmsg.exe` | Browser native-messaging host. Bridges the FocusLock extension ⇄ the service pipe, pushing live `{active, mode, domains}`. Spawned by the browser; not user-run. |

## Enforcement (v1 pragmatic subset)

- **Websites:** a loopback DNS sinkhole (`enforce/dns.rs`) on `127.0.0.1:53` answers NXDOMAIN
  for blocked names and forwards allowed names upstream; every adapter's DNS is pointed at the
  sinkhole and re-asserted periodically. A Windows-Firewall rule (`enforce/wfp.rs`) blocks
  DNS-over-TLS (port 853).
- **VPN-transparent connect block:** a WinDivert **SOCKET-layer** engine (`enforce/divert.rs`,
  `run_socket_engine`) blocks `connect()` to in-scope destinations *at connection setup* — before
  the OS routes the packet into a VPN tunnel — so the IP-first taint/clean model holds even behind a
  full-tunnel VPN (the NETWORK-layer engines see only encrypted traffic to the VPN server). The
  SOCKET layer can't inject (RECV_ONLY), so blocking is driven entirely by the filter string
  (`build_socket_filter`); the engine recvs only to drain blocked events. Scoped to web ports with
  loopback/private ranges exempted, so DNS and LAN/localhost never break.
- **Apps:** a ~1s process poll (`enforce/apps.rs`) terminates blocked executables.
- **Disable gate:** `core.rs` re-checks USB presence on every `disableFocus` and refuses
  without a present paired key (or during a `locked` schedule window).

## Deferred (documented hardening upgrades)

Raw FWPM/BFE filters with weight-based permit-exceptions, whitelist/block-all network filters,
a DoH-endpoint IP blocklist, SetupAPI VID/PID/serial device identity, ETW/WMI process-create
pre-exec denial, DPAPI-wrapping of the (hash-only) secure store, and a `WM_DEVICECHANGE` event
window. None are required for the v1 product goal (raise the activation energy of cheating).

A **force-installed browser extension** (`apps/extension`, wired by `enforce::extension_policy` via
Chromium `ExtensionInstallForcelist` + Firefox `Extensions\Install`/`Locked`, fed live state by
`focuslock-natmsg.exe`) does per-URL request-layer blocking where the SNI is encrypted (ECH), the
transport is QUIC, or connections are pooled — the cases the wire layers can't see, and the gap that
matters most in **Firefox** (excluded from the managed `URLBlocklist` path). The SOCKET-layer connect
block + taint-drop remain the backstop for non-browser apps. Packaging the extension (stable
ids/CRX/XPI) is documented in `apps/extension/README.md`.

## Build

```powershell
cargo build --release   # produces target\release\focuslock-{svc,svcctl,recover}.exe
```

`scripts/build-native-win.mjs` runs this and stages the binaries into
`apps/desktop/resources/bin/win/` for electron-builder to embed.

> Built and tested on **native Windows** with the MSVC toolchain (the crate links Win32 APIs
> and uses Windows named pipes / SCM). It does not build on Linux/WSL.
