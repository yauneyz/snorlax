# FocusLock Windows service (Rust)

One crate, three binaries (see `Cargo.toml`):

| Binary | Role |
|---|---|
| `focuslock-svc.exe` | The privileged service. SCM-managed (LocalSystem, auto-start). Run `--console` for a foreground dev instance. |
| `focuslock-svcctl.exe` | Elevated install/configure/recover/remove CLI. Generates the recovery code at install. |
| `focuslock-recover.exe` | The killswitch — `--code XXXX-XXXX-XXXX` force-disables focus and tears down enforcement. |

## Enforcement (v1 pragmatic subset)

- **Websites:** a loopback DNS sinkhole (`enforce/dns.rs`) on `127.0.0.1:53` answers NXDOMAIN
  for blocked names and forwards allowed names upstream; every adapter's DNS is pointed at the
  sinkhole and re-asserted periodically. A Windows-Firewall rule (`enforce/wfp.rs`) blocks
  DNS-over-TLS (port 853).
- **Apps:** a ~1s process poll (`enforce/apps.rs`) terminates blocked executables.
- **Disable gate:** `core.rs` re-checks USB presence on every `disableFocus` and refuses
  without a present paired key (or during a `locked` schedule window).

## Deferred (documented hardening upgrades)

Raw FWPM/BFE filters with weight-based permit-exceptions, whitelist/block-all network filters,
a DoH-endpoint IP blocklist, SetupAPI VID/PID/serial device identity, ETW/WMI process-create
pre-exec denial, DPAPI-wrapping of the (hash-only) secure store, and a `WM_DEVICECHANGE` event
window. None are required for the v1 product goal (raise the activation energy of cheating).

## Build

```powershell
cargo build --release   # produces target\release\focuslock-{svc,svcctl,recover}.exe
```

`scripts/build-native-win.mjs` runs this and stages the binaries into
`apps/desktop/resources/bin/win/` for electron-builder to embed.

> Built and tested on **native Windows** with the MSVC toolchain (the crate links Win32 APIs
> and uses Windows named pipes / SCM). It does not build on Linux/WSL.
