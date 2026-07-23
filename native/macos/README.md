# Talysman macOS Native Backend

This crate is the macOS counterpart to `native/linux` and `native/windows`. It speaks the same
NDJSON-RPC protocol as the Electron app, but swaps the platform edges:

- IPC: Unix-domain socket at `/var/run/talysman/talysman.sock` in production and
  `/tmp/talysman-dev.sock` in console/dev mode.
- Service manager: `sudo talysman-svcctl install` writes a LaunchDaemon plist
  (`/Library/LaunchDaemons/app.talysman.svc.plist`, label `app.talysman.svc`, RunAtLoad +
  KeepAlive) and loads it with `launchctl bootstrap system`. Uninstall/stop use `bootout`.
- Website blocking: pf (packet filter) rules fed by the same warm resolver-owned IP bank as
  Linux. Rules load into the anchor `com.apple/talysman`, which the stock `/etc/pf.conf`
  wildcard anchor (`anchor "com.apple/*"`) already evaluates — no pf.conf edits. pf tables hold
  v4+v6 together; whitelist mode is `pass out quick` to the allowed table then a
  `block drop out quick` backstop on ports 80/443 (+ QUIC udp/443), since pf can't negate a
  table match. DoT (853) is always dropped while focus is active.
- DNS sinkhole: a marker-delimited block spliced into `/etc/hosts` for blacklist domains (plus
  `www.` variants and DoH-bypass endpoints), flushed via `dscacheutil -flushcache` +
  `killall -HUP mDNSResponder`. macOS ships no dnsmasq; deeper subdomains are caught by the pf
  IP rules.
- App/browser identity: the CFBundleIdentifier of the innermost enclosing `.app` bundle, read
  from `Contents/Info.plist`. Helper bundles (`com.google.Chrome.helper`) prefix-match their
  browser, so the watchdog collapses them into the browser root as on other platforms.
- USB keys: volumes under `/Volumes` (symlinks skipped — the boot volume's entry is one), using
  the `diskutil info` "Volume UUID" as the primary identity signal (cached per mount point).
  `.talysman/key.bin` is written only when a volume exposes no stable UUID.
- State: `/Library/Application Support/Talysman` (override with `TALYSMAN_DATA_DIR`).

## Developing on Linux

Release builds are gated to a darwin host by `scripts/build-native.mjs`, but the crate itself
compiles on any Unix on purpose: every macOS-only edge (pfctl, diskutil, launchctl, hosts flush)
is a plain subprocess/file call that degrades to a logged warning, so `cargo check` /
`cargo test` run fine on a Linux dev box and in CI. `TALYSMAN_HOSTS_FILE` and
`TALYSMAN_USB_MOUNTS` redirect the hosts file and volume scan for tests/dev.

## Needs a real Mac to verify

- pf runtime behavior: anchor loading, `pfctl -E` reference counting, actual packet drops.
- `/etc/hosts` splice + cache flush end-to-end (SIP does not protect /etc/hosts, but verify).
- launchd bootstrap/bootout on current macOS, and daemon restart-on-kill via KeepAlive.
- `diskutil info` output parsing against real removable media.
- Packaging: signing, notarization, and a proper installer flow around `talysman-svcctl install`.

Known follow-ups:

- Harden with the architecture doc's Swift NetworkExtension/EndpointSecurity design once Apple
  entitlements are in hand; this Rust daemon is the entitlement-free first cut.
- Extract the duplicated Rust protocol/core modules into a shared native crate (now duplicated
  three ways).

The elevated installer and LaunchDaemon startup register `com.talysman.host` in the system-wide
native messaging locations for Chrome, Chrome for Testing, Chromium, Edge, and Firefox. This
registration does not install or lock the browser extension.
