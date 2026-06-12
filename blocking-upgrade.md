# Blocking upgrade: learned data-plane drop (stateless egress block by destination)

> **Status: IMPLEMENTED (2026-06-12).** Decisions taken: per-IP taint learned from SNI with
> allowed-SNI guard and TTL; drop scoped to **port 443 only** (TCP + UDP); enforcement is a
> dedicated WinDivert handle opened with the **DROP flag** (`WinDivertFlags::set_drop()` —
> driver-side silent drop, no recv loop, zero per-packet user-space cost), filter rebuilt from
> the taint set on membership change (`run_taint_drop` in `enforce/divert.rs`); the WFP/netsh
> backstop is **deferred**. One addition beyond the proposal below: the SNI engine is now
> **always-on** (record-only filter while unfocused), because the mechanism as proposed cannot
> taint a pooled socket opened *before* focus-on — its ClientHello already happened, and with
> DNS sinkholed the browser may never send another one to learn from. Recording SNIs while
> unfocused lets focus-on seed taints from flows whose recorded SNI is blocked, which closes the
> observed reddit/x.com leak even if every RST probe misses. **Seeding is done two ways:** a fast
> in-memory pass over the recorded flow→SNI map (`EnforceShared::seed_taints_from_flows`, called
> synchronously from `core::set_focus`/`set_policy` *before* the slow reset path) so a
> pooled/coalesced socket dies within ~50ms instead of the ~1s the x.com HAR
> (`x.com_Archive 26-06-12`) showed it coasting; plus the reset worker's pass over live
> established connections (`reset_browser_connections`) as a safety net. The taint-drop manager
> polls at `TAINT_POLL` (50ms) so the DROP filter installs promptly. Taint state lives on
> `EnforceShared` (`taint` / `note_allowed` / `tainted_ips` / `seed_taints_from_flows` /
> `clear_taints`); taints clear on focus-off.
>
> **HAR diagnosis (x.com, 2026-06-12):** every served request (9 x.com + 142 twimg `200`s) rode a
> pre-existing pooled socket — `connect=0/ssl=0`, zero new handshakes — to Cloudflare
> `162.159.140.229` (x.com/api.x.com) and Fastly `151.101.40.159` (twimg, correctly covered by
> the x.com property group). Every *new* connection was blocked (`status 0`). Confirms the leak is
> purely pooled sockets and motivated the fast in-memory seed above.
>
> **Opaque-socket gap + per-flow drop (2026-06-12):** service logs showed `taint drop active`
> never fired for the x.com session — the pooled socket *predated the service restart* that
> deployed this build, so its ClientHello was never recorded (no SNI to seed from), and new x.com
> connections die at DNS (NXDOMAIN) before producing a ClientHello to taint the IP. Nothing
> connects "x.com blocked" to "kill `162.159.140.229`" — the socket is opaque to every
> observation point (no DNS query, no handshake, no recorded SNI); all we know is its TCP 4-tuple.
> A per-IP blanket taint can't fix this: dropping all 443 to an IP also drops a *new* connection's
> SYN, so an allowed site on that IP can never reconnect or reveal an allowed SNI to untaint
> itself (TTL-long deadlock). The fix is a **per-4-tuple drop** seeded at focus-on from every
> established browser 443 socket (`EnforceShared::drop_flow`, `dropped_flows`; filter built by
> `build_drop_filter`): a reliable, standing form of the RST burst's clean-slate teardown that
> mutes an already-open socket regardless of whether we know its hostname, while an allowed site
> reconnects on a fresh local port (a different tuple, not in the set) with zero collateral. The
> SNI engine also `untaint`s a per-IP taint on an observed allowed ClientHello, so a shared-CDN IP
> recovers on its next handshake.

_Last updated 2026-06-12. Companion to `limitation.md` and `quic-upgrade.md`. Context: the
WinDivert engine blocks at **handshake time** (DNS NXDOMAIN + SNI RST on new TCP-443
ClientHellos) and tears down already-open sockets with a **one-shot RST burst** on focus-on /
policy change (`enforce::divert::reset_browser_connections`). This doc proposes adding a
**stateless egress drop** layer — the mechanism the Linux sibling `focusd` uses — to close the
pooled/coalesced-socket leak at its root._

## The leak this closes

Observed against reddit (two HAR captures, 2026-06-12): with all reddit sibling domains blocked
(property groups working — siblings served from cache only), `www.reddit.com` still loaded over a
**single pre-existing HTTP/2 socket** to a Fastly IP, every request `200`, `connect=0/ssl=0`
(reused socket, no new handshake). The block never fired because:

1. **No handshake to inspect.** A pooled/coalesced H2 socket carries `www.reddit.com` requests
   with no fresh ClientHello, so `run_sni_engine` never sees the SNI.
2. **The RST burst is a one-shot hunt.** `reset_browser_connections` snapshots established TCP
   flows at the toggle instant and tries to RST them (challenge-ACK probe for idle sockets). It
   can miss a socket — challenge ACKs are rate-limited, a stray SYN can be dropped, and a socket
   re-pooled just after the snapshot isn't in the killset. (The repeated-probe change of
   2026-06-12 improves reliability but is still a *find-and-reset* race.)

Root issue: **we enforce per-connection and per-handshake, so a connection with no handshake that
we fail to find stays alive.** Closing the browser "fixes" it only because that kills the socket
for us — and even that fails when the browser keeps background processes alive (Chrome/Edge
"continue running background apps").

## How `focusd` avoids it (the idea we're borrowing)

`focusd` (sibling repo, Linux) never tears down connections. It enforces with a **stateless
nftables `drop` in the `output` hook, keyed on destination IP** (`internal/nft/nft.go`,
`addDropRule`): `nfproto match → dest-IP ∈ blocked_set → drop`. Crucially there is **no `ct state`
match** — the kernel drops *every* outbound packet to a blocked IP, on every socket, regardless of
when it was opened. Enabling blocking just repopulates the IP set; existing pooled/coalesced
sockets to those IPs go dead instantly. No RST, no handshake interception, no timing race — the
whole bug class is designed out.

The cost `focusd` pays (and why snorlax didn't start here): it blocks by **IP, coarsely**
(`internal/daemon/daemon.go` resolves blocked domains → IPs up front), so a CDN IP shared with an
allowed tenant is over-blocked, and it needs a **periodic re-resolve ticker** because CDN IPs
rotate. snorlax chose SNI precisely to avoid CDN over-block (see `limitation.md`).

## Proposal: learn the drop set from SNI, enforce it stateless

Keep SNI for **precision** (what to block), borrow `focusd`'s stateless drop for **enforcement**
(how to make it stick). Instead of pre-resolving a coarse IP list, **taint a destination only
after the SNI engine has positively seen a blocked host go to it**, then drop all further egress
to that destination for the rest of the focus session. This generalizes the UDP-443 (QUIC) drop
already added to `run_sni_engine`, which is the same shape: "while focused, drop packets matching a
condition rather than reset a connection."

### Mechanism

1. **Tainted-destination set** on `EnforceShared` (new field), e.g.
   `tainted: Mutex<HashMap<IpAddr, Instant>>` (Instant = last-seen, for TTL eviction). Focus-gated
   and **cleared on focus-off** (alongside the existing teardown).
2. **Learn on block.** In `handle_sni_packet`, when `is_host_blocked` / `is_doh_bypass_host`
   matches, in addition to the RST, insert the flow's `pkt.dst` into `tainted`. (We already have
   the remote IP in hand there.) This is the precise signal — we only taint an IP we've watched
   serve a blocked SNI on the wire.
3. **Enforce stateless.** Drop subsequent outbound packets whose `DstAddr ∈ tainted` while
   focused. Two placement options:
   - **In the WinDivert engine** (extend `ENGINE_FILTER` / a dedicated handle): pure user-mode,
     no signing, mirrors the existing data-plane drops. Downside: every packet to a tainted IP is
     copied to user space until the flow dies — transient, since a dropped flow goes quiet fast.
   - **As a transient WFP rule** (`enforce::wfp`, `netsh advfirewall ... remoteip=<IP>`): kernel
     drop, zero per-packet user-space cost, and survives a service kill (kill-resistant backstop,
     same role `block_quic`'s rule plays for QUIC). Downside: netsh rule churn; coarser lifecycle.

   Recommended: do the drop **in the engine** for liveness (instant, precise eviction) and
   **optionally** push long-lived taints into a WFP rule as the kill-resistant backstop — the same
   two-layer split `quic-upgrade.md` settled on.
4. **TTL + eviction.** Age out taints (e.g. a few minutes idle) so a CDN IP that rotates away from
   a blocked tenant isn't blocked forever. Re-tainted on the next observed blocked SNI.

### Granularity: per-IP vs per-flow (the over-block question)

- **Per-flow 4-tuple** `(local, lport, remote, rport)` is maximally precise but **does not defeat
  coalescing**: coalescing multiplexes allowed + blocked requests onto *one* socket, and the next
  socket can re-coalesce the blocked host again. Killing one tuple is just a slower RST.
- **Per-destination-IP** is what actually closes the leak (it's why `focusd`'s coarse approach
  works), at the cost of over-blocking an allowed co-tenant on a shared CDN IP **for the TTL
  window**. Mitigations: (a) only taint via observed blocked SNI (never pre-emptively), (b) short
  TTL, (c) an allowlist guard so we never taint an IP we've *also* just seen serve an allowed SNI
  (record allowed-SNI IPs too and skip tainting those — favors precision over completeness on
  truly-shared IPs). Note the reddit case is **not** truly shared from the browser's view: a
  reddit-cert socket only coalesces reddit hosts, all of which are blocked, so tainting its IP has
  no allowed collateral in practice.

Recommendation: **per-IP taint, learned from SNI, short TTL, with an allowed-SNI guard.** Precise
where it can be, coarse only on the specific IPs proven to serve blocked content.

## Integration points (today's code)

- `enforce/mod.rs` — add `tainted` to `EnforceShared`; helpers `taint(ip)`, `is_tainted(ip)`,
  `clear_taints()`; call `clear_taints()` from the focus-off path (where `apply_network(false)` /
  teardown runs).
- `enforce/divert.rs::handle_sni_packet` — on a blocked match, `shared.taint(pkt.dst)` next to the
  RST; optionally `shared.untaint`-guard on an allowed match (record allowed IP).
- `enforce/divert.rs` engine — drop outbound packets to tainted dests (new filter clause or a
  check in `handle_packet`). Generalizes the UDP-443 drop already present.
- `enforce/wfp.rs` (optional backstop) — `block_dest_ip(ip)` / `clear_dest_blocks()` for promoting
  long-lived taints to kernel firewall rules.
- Tunables alongside `RESET_BURST` / `PROBE_INTERVAL`: `TAINT_TTL`, eviction cadence.

The one-shot RST burst stays — it's still the fastest way to kill the bulk of sockets at toggle.
The taint set is the **safety net** that makes a missed/re-pooled socket die anyway, turning
"find and reset once" into focusd's "the socket simply can't send."

## Comparison

| Approach | What it blocks on | Pooled/coalesced socket | CDN over-block | IP rotation | Signing |
|---|---|---|---|---|---|
| snorlax today (SNI RST + reset burst) | new ClientHello; one-shot teardown | **leaks if missed** | none (hostname-precise) | n/a | none |
| focusd (nft IP drop) | pre-resolved dest IP | dies instantly | **yes** (coarse) | needs re-resolve ticker | none |
| **Proposed (SNI-learned IP taint)** | observed blocked SNI → dest IP | **dies instantly** | only tainted IPs, TTL-bounded, allow-guarded | self-heals (learned live, TTL) | none |

## Decision / signing note

- **No new signing.** Like option 2 in `limitation.md` and the QUIC engine drop, this is
  user-mode WinDivert capture + (optionally) `netsh` firewall rules — no kernel callout, no driver
  cert. Only the deferred WFP connect-redirect (option 3) would need signing.
- **When to do it:** this is the principled fix for the pooled/coalescing leak that SNI alone
  can't reach. Pair it with the repeated-probe reset already shipped; do it when the residual
  leak (background-process pooled sockets surviving toggle) proves worth closing for real.
