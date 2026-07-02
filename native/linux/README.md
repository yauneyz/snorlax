# Talysman Linux Native Backend

This crate is the Linux counterpart to `native/windows`. It speaks the same NDJSON-RPC protocol as
the Electron app, but swaps the platform edges:

- IPC: Unix-domain socket at `/run/talysman/talysman.sock` in production and `/tmp/talysman-dev.sock`
  in console/dev mode.
- Service manager: `talysman-svcctl install` writes and starts a systemd unit.
- Website blocking: focusd-style nftables output-hook rules fed by a warm resolver-owned IP bank.
- USB keys: `.talysman/key.bin` on mounted drives under `/run/media`, `/media`, or `/mnt`.

The resolver refreshes A/AAAA records directly through `/etc/resolv.conf` nameservers, then public
fallbacks, and swaps the full blocked/allowed set into nftables. Blacklist mode drops resolved
blocked IPs; whitelist and block-all default-deny web egress (`80`, `443`, and QUIC `udp/443`).

Known follow-ups:

- Add distro/browser-specific native-messaging host registration without consumer force-install
  policy.
- Add a DNS-layer sinkhole or dnsmasq integration if we want focusd's full dual-layer behavior.
- Replace serial-ambiguous USB matching with udev/lsblk-backed device identity where available.
- Extract the duplicated Rust protocol/core modules into a shared native crate once macOS arrives.
