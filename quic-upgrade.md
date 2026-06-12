# QUIC / HTTP-3 SNI handling: current approach and the proposed upgrade

_Last updated 2026-06-12. Companion to `limitation.md`. Context: FocusLock now blocks by the
SNI in the TLS ClientHello on **TCP** 443 (see `native/windows/src/enforce/sni.rs` +
`enforce::divert::run_sni_engine`). This doc covers the **UDP** 443 / QUIC side: what we do today
and the principled upgrade we deferred._

## Background: why SNI, and why QUIC is the gap

SNI-based blocking reads the hostname the browser actually puts on the wire, so it's immune to
CDN-shared domains, hardcoded IPs, and stale DNS (the leaks in `limitation.md`). On **TCP** 443
the ClientHello — and its `server_name` (SNI) extension — is sent in cleartext in the first
handshake packet, so our WinDivert engine parses it directly.

**HTTP/3 runs over QUIC on UDP 443**, and QUIC encrypts its ClientHello inside the first
*Initial* packet. We can't read that SNI by simply slicing the payload the way we do for TCP. So
if we did nothing about QUIC, a browser could open an HTTP/3 connection to a blocked host and our
SNI inspector would never see the hostname — the block would leak over h3.

## Current approach (shipped): block UDP 443 to force TCP fallback

We drop **all outbound UDP 443** while focus is active, then let the browser fall back to
HTTP/2 over TCP, where the SNI inspector works. Two layers:

- **Data plane (primary):** the focus-gated 443 inspection engine
  (`enforce::divert::run_sni_engine`) captures outbound UDP 443 alongside TCP handshakes and
  drops it. Because this is per-*packet*, it also starves QUIC sessions that were **already
  established when focus turned on** (e.g. pooled h3 sessions opened during a focus-off window) —
  the leak that previously let a blocked site keep loading until the browser was closed. The
  reset burst can't reach these (it enumerates and RSTs TCP only; UDP has no RST), and a firewall
  rule added mid-flow may not cut an already-authorized UDP flow (WFP flow reauthorization is
  unreliable for that). Dropped flows go quiet immediately, so the user-space cost is transient.
- **Firewall rule (backstop):** `native/windows/src/enforce/wfp.rs` → `block_quic()` (rule
  `FocusLock-QUIC-UDP`), toggled on in `enforce::apply_network(true)` alongside the DoT/DoH rules
  and removed in `clear_rules()` (focus-off and the killswitch). Kernel-level, zero per-packet
  user-space cost, and it keeps *new* QUIC flows blocked even if the service is killed (until the
  SCM restarts it).

**Trade-offs (accepted for now):**

- A browser that has cached a site as h3-capable (Alt-Svc) may try QUIC first and wait for it to
  fail before falling back to TCP, adding a **one-time, few-hundred-millisecond connection delay**
  on those sites (Google, YouTube, Cloudflare-fronted, …) the first time they're hit while
  focused. It's cached afterward, and only happens while focus is active.
- Steady-state throughput and latency are unaffected — TCP carries everything fine.
- All QUIC is blocked indiscriminately, including QUIC to *allowed* sites (they just use TCP).

This is the right default: simple, robust, no new parsing surface, and it fully closes the h3
leak. The cost is a minor, one-time, focus-only fallback delay.

## Proposed upgrade: parse the QUIC Initial packet's SNI (no forced fallback)

The no-compromise alternative is to read the SNI out of the QUIC Initial packet and RST/deny only
*blocked* h3 flows — leaving allowed HTTP/3 at full speed, removing the fallback delay entirely.
This is more work and more parsing surface, hence deferred.

### How QUIC Initial decryption works (why it's feasible without secrets)

QUIC Initial packets are encrypted, but with keys **derived from a published salt and the
client's Destination Connection ID (DCID)** — not from any negotiated secret. Any on-path
observer can compute them. The procedure (RFC 9001 §5.2, "Initial Secrets"):

1. Parse the QUIC long-header Initial packet: flags, version, DCID, SCID, token, length, packet
   number. (Handle QUIC v1 `0x00000001`; ignore/measure v2 and Version Negotiation.)
2. `initial_secret = HKDF-Extract(initial_salt, DCID)` with the version's published salt.
3. Derive `client_initial_secret`, then the header-protection key, packet-protection key, and IV
   via HKDF-Expand-Label ("client in", "quic key", "quic iv", "quic hp").
4. Remove header protection (AES-ECB sample over the packet-number field) to recover the packet
   number and the true header length.
5. AEAD-decrypt the payload (AES-128-GCM) using key/IV and the header as associated data.
6. Parse QUIC frames; reassemble `CRYPTO` frames (they carry the TLS ClientHello, and the
   ClientHello can span multiple CRYPTO frames / multiple Initial packets — post-quantum
   key-shares make this common).
7. Feed the reassembled ClientHello to the **existing** `enforce::sni::extract_sni` — the TLS
   parsing is identical to the TCP path; only the transport framing differs.

### Enforcement once we have the SNI

- Capture outbound UDP 443 Initial packets in a focus-gated WinDivert handle (mirror
  `run_sni_engine`); filter on the long-header Initial form to avoid touching steady-state 1-RTT
  packets.
- On a blocked SNI: drop the Initial and stop the handshake. QUIC has no RST; the clean signal is
  a **CONNECTION_CLOSE** in an Initial packet, or simply dropping Initials so the handshake times
  out fast. Dropping is simplest and matches the "drop the ClientHello" behavior on TCP.
- Record the flow's SNI in the same `flow_sni` map (`EnforceShared`) for surgical reset parity.
- With per-flow QUIC blocking in place, **remove `block_quic()` and the wholesale UDP-443 drop in
  `run_sni_engine`** so allowed h3 runs natively.

### Dependencies / cost

- Crates: an HKDF + AES-GCM implementation (`ring` or `aws-lc-rs`, or `hkdf` + `aes-gcm`). Adds a
  crypto dependency to the service.
- New pure, unit-testable module (e.g. `enforce::quic`) for header-protection removal, AEAD
  decrypt, and CRYPTO-frame reassembly — testable against captured Initial packets with no driver.
- Must track QUIC version salts (v1 today; add v2 and graceful handling of unknown versions).
- Performance stays good: only Initial packets are diverted (a few per new h3 connection), and
  1-RTT data stays in-kernel — same shape as the TCP handshake-only filter.

### When to do it

Pursue this if the one-time TCP-fallback delay on h3 sites proves noticeable/annoying in real use.
Until then, blocking UDP 443 is the pragmatic, fully-correct default.
