# FocusLock Linux Native Backend

This crate is the Linux counterpart to `native/windows`. It speaks the same NDJSON-RPC protocol as
the Electron app, but swaps the platform edges:

- IPC: Unix-domain socket at `/run/focuslock/focuslock.sock` in production and `/tmp/focuslock-dev.sock`
  in console/dev mode.
- Service manager: `focuslock-svcctl install` writes and starts a systemd unit.
- Website blocking: focusd-style nftables output-hook rules fed by a warm resolver-owned IP bank.
- USB keys: `.focuslock/key.bin` on mounted drives under `/run/media`, `/media`, or `/mnt`.

The resolver refreshes A/AAAA records directly through `/etc/resolv.conf` nameservers, then public
fallbacks, and swaps the full blocked/allowed set into nftables. Blacklist mode drops resolved
blocked IPs; whitelist and block-all default-deny web egress (`80`, `443`, and QUIC `udp/443`).

Known follow-ups:

- Add distro/browser-specific force-install policy for the shipped native-messaging host.
- Add a DNS-layer sinkhole or dnsmasq integration if we want focusd's full dual-layer behavior.
- Replace serial-ambiguous USB matching with udev/lsblk-backed device identity where available.
- Extract the duplicated Rust protocol/core modules into a shared native crate once macOS arrives.
