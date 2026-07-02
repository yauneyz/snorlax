# Talysman Windows service (Rust)

One crate, three binaries (see `Cargo.toml`):

| Binary | Role |
|---|---|
| `talysman-svc.exe` | The privileged service. SCM-managed (LocalSystem, auto-start). Run `--console` for a foreground dev instance. |
| `talysman-svcctl.exe` | Elevated install/configure/recover/remove CLI. Generates the recovery code at install. |
| `talysman-recover.exe` | The killswitch — `--code XXXX-XXXX-XXXX` force-disables focus and tears down enforcement. |
| `talysman-natmsg.exe` | Browser native-messaging host. Bridges the Talysman extension ⇄ the service pipe, pushing live `{active, mode, domains}`. Spawned by the browser; not user-run. |

## Enforcement (v1 pragmatic subset)

- **Websites/IPs:** a WinDivert DNS engine (`enforce/divert.rs` + `enforce/dns.rs`) answers
  NXDOMAIN for blocked DNS names while focused, without changing adapter DNS settings. A warm
  resolver ticker (`enforce/resolve.rs`) continuously resolves the expanded policy domains, even
  while focus is off, and swaps the blocked/allowed IP bank wholesale. The WinDivert NETWORK-layer
  drop handle then blocks outbound packets to the blocked destination IPs while focused, so
  pre-existing sockets cannot coast once their destination is in the bank. Windows-Firewall rules
  (`enforce/wfp.rs`) block DNS-over-TLS, DoH resolver IPs, and QUIC.
- **Apps:** a ~1s process poll (`enforce/apps.rs`) terminates blocked executables.
- **Disable gate:** `core.rs` re-checks USB presence on every `disableFocus` and refuses
  without a present paired key (or during a `locked` schedule window).

## Deferred (documented hardening upgrades)

Raw FWPM/BFE filters with weight-based permit-exceptions, whitelist/block-all network filters,
a DoH-endpoint IP blocklist, SetupAPI VID/PID/serial device identity, ETW/WMI process-create
pre-exec denial, DPAPI-wrapping of the (hash-only) secure store, and a `WM_DEVICECHANGE` event
window. None are required for the v1 product goal (raise the activation energy of cheating).

A **user-installed browser extension** (`apps/extension`, wired to the local native host by
`enforce::extension_policy` and fed live state by `talysman-natmsg.exe`) does per-URL request-layer
blocking where the wire/IP layer is too coarse or blind: encrypted SNI (ECH), VPNs, QUIC, and pooled
browser connections. The native IP drop remains the backstop for network-visible traffic and
non-browser apps. Store packaging and the permanent Chrome, Edge, and Firefox identities are
documented in `apps/extension/README.md`.

## Build

```powershell
cargo build --release   # produces target\release\talysman-{svc,svcctl,recover}.exe
```

`scripts/build-native-win.mjs` runs this and stages the binaries into
`apps/desktop/resources/bin/win/` for electron-builder to embed.

> Built and tested on **native Windows** with the MSVC toolchain (the crate links Win32 APIs
> and uses Windows named pipes / SCM). It does not build on Linux/WSL.
