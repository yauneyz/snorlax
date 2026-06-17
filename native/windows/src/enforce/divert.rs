//! WinDivert packet engine (architecture §4.1). This is the consolidated replacement for the
//! old loopback DNS sinkhole + PowerShell adapter-DNS repointing + reassert task. One
//! always-running OS thread owns a WinDivert NETWORK-layer handle and, while focus is active:
//!
//!   * intercepts outbound DNS (UDP/53) and answers NXDOMAIN for blocked names (and DoH
//!     bootstrap hostnames) by injecting a spoofed reply, dropping the original query;
//!   * drops outbound DNS-over-TLS/QUIC (port 853);
//!   * passes everything else through unchanged.
//!
//! Because we filter by destination *port* (not by adapter DNS settings), this also catches
//! apps that hard-code a resolver IP — the gap the old adapter-repointing approach left open.
//! No system DNS configuration is mutated.
//!
//! A SOCKET-layer handle (`run_socket_engine`) closes the **VPN bypass**. The NETWORK-layer engines
//! above see packets *after* routing, so under a full-tunnel VPN they see only encrypted blobs to
//! the VPN server — no SNI, no real destination IP, no plaintext DNS. The SOCKET layer instead
//! intercepts `connect()` *at setup*, before the OS routes the packet into the tunnel, so the real
//! destination IP + process are visible and the IP-first model holds regardless of any VPN. The
//! SOCKET layer can't inject/re-inject (RECV_ONLY is mandatory) — a connect that matches the filter
//! is blocked and one that doesn't proceeds, so the **filter string is the whole control surface**
//! (built by `build_socket_filter`, same polarity as the taint-drop filter); the recv loop only
//! drains the queued blocked events so the queue can't overflow into fail-open. This is additive:
//! the NETWORK-layer taint-drop handle remains the data-plane backstop that starves pooled or
//! pre-existing 443 sockets after focus turns on.
//!
//! A second, short-lived handle implements connection reset: on a toggle/policy-change signal
//! we snapshot established TCP flows owned by browser (and blocked-app) processes and inject
//! TCP RSTs to tear them down, so a newly-blocked site dies immediately instead of coasting on
//! an already-open socket. RSTs use the sequence number observed on a live packet, so they are
//! accepted by the stack — and this works uniformly for IPv4 and IPv6 (unlike `SetTcpEntry`).
//!
//! Anti-tamper note: WinDivert blocking only holds while this process runs. If the service is
//! killed, domain blocking lapses until the SCM restarts us (~1s); the persistent Windows
//! Firewall rules in `enforce::wfp` (DoT + DoH-IP) are the backstop. True kill-resistant DNS
//! blocking is the deferred kernel-WFP callout.

use std::ffi::{c_void, CString};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use windivert_sys::address::WINDIVERT_ADDRESS;
use windivert_sys::{
    ChecksumFlags, WinDivertClose, WinDivertFlags, WinDivertHelperCalcChecksums, WinDivertLayer,
    WinDivertOpen, WinDivertRecv, WinDivertSend, WinDivertShutdown, WinDivertShutdownMode,
};
use windivert_win::Win32::Foundation::HANDLE;

use crate::enforce::dns::{
    nodata_reply, nxdomain_reply, qtype, read_qname, QTYPE_HTTPS, QTYPE_SVCB,
};
use crate::enforce::resolve::RESOLVER_SRC_PORT;
use crate::enforce::sni::extract_sni;
use crate::enforce::EnforceShared;
use crate::model::{Mode, Policy};
use crate::policy_match::{is_doh_bypass_host, is_host_blocked};

const PROTO_TCP: u8 = 6;
const PROTO_UDP: u8 = 17;
const PORT_DNS: u16 = 53;
const PORT_DOT: u16 = 853;
const PORT_HTTPS: u16 = 443;
/// TCP RST flag (the 13th byte of the TCP header). Used by the SNI engine to tear down a blocked
/// new connection's handshake.
const TCP_FLAG_RST: u8 = 0x04;

// ---------------------------------------------------------------------------
// Raw WinDivert handle wrapper
// ---------------------------------------------------------------------------

/// Thin owned wrapper around a WinDivert handle. WinDivert's recv/send/shutdown are
/// thread-safe, so we mark it `Send` and hand the raw value to a timer thread for shutdown.
struct Diverter {
    handle: HANDLE,
}

// SAFETY: WinDivert handles may be used concurrently from multiple threads (recv on one,
// shutdown/close on another), which is exactly how the reset burst is torn down.
unsafe impl Send for Diverter {}

impl Diverter {
    fn open(filter: &str, priority: i16, flags: WinDivertFlags) -> std::io::Result<Self> {
        Self::open_layer(filter, WinDivertLayer::Network, priority, flags)
    }

    /// Open a handle at an explicit layer. The NETWORK-layer engines use `open`; the connect-block
    /// engine opens the SOCKET layer (which intercepts socket operations at setup, before any VPN
    /// encapsulation — see the module header).
    fn open_layer(
        filter: &str,
        layer: WinDivertLayer,
        priority: i16,
        flags: WinDivertFlags,
    ) -> std::io::Result<Self> {
        let cfilter = CString::new(filter)
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "filter has NUL"))?;
        let handle = unsafe { WinDivertOpen(cfilter.as_ptr(), layer, priority, flags) };
        if handle.0 == 0 || handle.0 == -1 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(Self { handle })
    }

    /// Receive a layer event that carries no packet data (SOCKET layer). WinDivert wants a NULL
    /// packet buffer for non-data layers; we only need the `WINDIVERT_ADDRESS` (to drain the queued,
    /// already-blocked event — the SOCKET layer has no re-inject, so the filter is the control
    /// surface and draining just keeps the queue from overflowing into fail-open).
    fn recv_event(&self) -> std::io::Result<WINDIVERT_ADDRESS> {
        let mut addr = WINDIVERT_ADDRESS::default();
        let mut len = 0u32;
        let ok =
            unsafe { WinDivertRecv(self.handle, std::ptr::null_mut(), 0, &mut len, &mut addr) };
        if ok.as_bool() {
            Ok(addr)
        } else {
            Err(std::io::Error::last_os_error())
        }
    }

    fn recv(&self, buf: &mut [u8]) -> std::io::Result<(usize, WINDIVERT_ADDRESS)> {
        let mut addr = WINDIVERT_ADDRESS::default();
        let mut len = 0u32;
        let ok = unsafe {
            WinDivertRecv(
                self.handle,
                buf.as_mut_ptr() as *mut c_void,
                buf.len() as u32,
                &mut len,
                &mut addr,
            )
        };
        if ok.as_bool() {
            Ok((len as usize, addr))
        } else {
            Err(std::io::Error::last_os_error())
        }
    }

    fn send(&self, data: &[u8], addr: &WINDIVERT_ADDRESS) -> std::io::Result<()> {
        let mut sent = 0u32;
        let ok = unsafe {
            WinDivertSend(
                self.handle,
                data.as_ptr() as *const c_void,
                data.len() as u32,
                &mut sent,
                addr,
            )
        };
        if ok.as_bool() {
            Ok(())
        } else {
            Err(std::io::Error::last_os_error())
        }
    }

    fn raw(&self) -> isize {
        self.handle.0
    }
}

impl Drop for Diverter {
    fn drop(&mut self) {
        unsafe {
            let _ = WinDivertClose(self.handle);
        }
    }
}

/// Recalculate IP/TCP/UDP checksums in-place and update the address checksum flags.
fn calc_checksums(buf: &mut [u8], addr: &mut WINDIVERT_ADDRESS) {
    unsafe {
        let _ = WinDivertHelperCalcChecksums(
            buf.as_mut_ptr() as *mut c_void,
            buf.len() as u32,
            addr,
            ChecksumFlags::new(),
        );
    }
}

/// Derive an inbound injection address from a captured outbound one: same interface and IP
/// family, but delivered *to* the local stack so the local app sees our manufactured packet.
fn inbound_addr_from(captured: &WINDIVERT_ADDRESS) -> WINDIVERT_ADDRESS {
    let mut addr = *captured;
    addr.set_outbound(false);
    addr
}

// ---------------------------------------------------------------------------
// Always-on DNS / DoT engine
// ---------------------------------------------------------------------------

/// Capture every outbound DNS/DoT packet so policy changes take effect live. The handle stays
/// open for the whole service lifetime; when focus is off we simply reinject everything. Our own
/// active resolver (enforce::resolve) binds a fixed local source port; we exclude it so the
/// sinkhole never poisons our own lookups while focus is active. The filter is split per protocol
/// so each `SrcPort` term only references its own layer's field (a `tcp.SrcPort` term on a UDP
/// packet would otherwise be false and break the UDP clause).
fn engine_filter() -> String {
    format!(
        "outbound and ((udp and (udp.DstPort == 53 or udp.DstPort == 853) and udp.SrcPort != {p}) \
         or (tcp and (tcp.DstPort == 53 or tcp.DstPort == 853) and tcp.SrcPort != {p}))",
        p = RESOLVER_SRC_PORT
    )
}

pub fn run_engine(shared: Arc<EnforceShared>, shutdown: tokio::sync::watch::Receiver<bool>) {
    let diverter = match Diverter::open(&engine_filter(), 0, WinDivertFlags::new()) {
        Ok(d) => d,
        Err(e) => {
            tracing::error!("WinDivert engine open failed: {e} (driver missing or no privilege?)");
            return;
        }
    };
    tracing::info!("WinDivert DNS/DoT engine running");
    let mut buf = vec![0u8; 65535];

    loop {
        if *shutdown.borrow() {
            break;
        }
        let (n, addr) = match diverter.recv(&mut buf) {
            Ok(x) => x,
            Err(e) => {
                if *shutdown.borrow() {
                    break;
                }
                tracing::warn!("WinDivert recv error: {e}");
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
        };
        let data = &buf[..n];

        // Focus off, or we handled (dropped/answered) the packet → otherwise reinject as-is.
        let consumed = if shared.is_active() {
            handle_packet(&diverter, &shared.policy_snapshot(), data, &addr)
        } else {
            false
        };
        if !consumed {
            let _ = diverter.send(data, &addr);
        }
    }
    tracing::info!("WinDivert DNS/DoT engine stopped");
}

/// Classify one captured outbound packet. Returns `true` if it was consumed (dropped or
/// answered) and must NOT be reinjected; `false` to let the caller pass it through.
fn handle_packet(
    diverter: &Diverter,
    policy: &Policy,
    data: &[u8],
    addr: &WINDIVERT_ADDRESS,
) -> bool {
    let Some(pkt) = parse_ip(data) else {
        return false;
    };

    match pkt.proto {
        PROTO_UDP => {
            let Some((sport, dport, payload_off)) = udp_ports_payload(data, pkt.l4_off) else {
                return false;
            };
            if dport == PORT_DOT {
                return true; // drop DoT/DoQ
            }
            if dport == PORT_DNS {
                let payload = &data[payload_off..];
                if let Some((name, qend)) = read_qname(payload) {
                    if is_doh_bypass_host(&name) || is_host_blocked(policy, &name) {
                        tracing::debug!("sinkholed {name}");
                        // Spoof a reply server->app: swap addrs + ports, inject inbound.
                        let reply = nxdomain_reply(payload, qend);
                        return inject_dns_reply(diverter, &pkt, sport, dport, &reply, addr);
                    }
                    // ECH suppression: refuse HTTPS/SVCB records so a browser can't fetch an
                    // Encrypted-ClientHello config and hide its SNI from the 443 inspector. The
                    // browser falls back to A/AAAA with a cleartext SNI.
                    if matches!(qtype(payload, qend), Some(QTYPE_HTTPS) | Some(QTYPE_SVCB)) {
                        tracing::debug!("ECH-suppressed HTTPS/SVCB query for {name}");
                        let reply = nodata_reply(payload, qend);
                        return inject_dns_reply(diverter, &pkt, sport, dport, &reply, addr);
                    }
                }
                false // allowed name → reinject so it reaches the real resolver
            } else {
                false
            }
        }
        PROTO_TCP => {
            let Some(tcp) = tcp_fields(data, pkt.l4_off) else {
                return false;
            };
            // Drop DoT-over-TCP; TCP/53 (rare) is passed through.
            tcp.dport == PORT_DOT
        }
        _ => false,
    }
}

/// Inject a spoofed DNS reply back to the querying app (server->app), dropping the original
/// query. Returns true (consumed) on success, false if the reply couldn't be built.
fn inject_dns_reply(
    diverter: &Diverter,
    pkt: &IpPkt,
    sport: u16,
    dport: u16,
    reply: &[u8],
    addr: &WINDIVERT_ADDRESS,
) -> bool {
    let mut out = build_udp_reply(pkt.dst, pkt.src, dport, sport, reply);
    if out.is_empty() {
        return false;
    }
    let mut reply_addr = inbound_addr_from(addr);
    calc_checksums(&mut out, &mut reply_addr);
    let _ = diverter.send(&out, &reply_addr);
    true
}

// ---------------------------------------------------------------------------
// SNI inspection engine (TCP 443)
// ---------------------------------------------------------------------------

/// Narrow filter used while focus is active: the first TLS handshake record of each outbound
/// TCP 443 connection (record content-type 0x16, version 0x03xx), plus all outbound UDP 443
/// (QUIC). Application-data TCP packets (0x17) — i.e. all bulk traffic — never match, so they
/// stay in the kernel and steady-state throughput is untouched. UDP 443 is dropped wholesale
/// while focused: unlike the `FocusLock-QUIC-UDP` firewall rule (which authorizes per *flow* and
/// may not cut sessions established while focus was off), a data-plane drop starves pooled h3
/// sessions mid-flight, so the browser falls back to TCP where the SNI check applies. Dropped
/// flows go quiet immediately, so the per-packet user-space cost is transient.
const SNI_FILTER: &str = "outbound and ((tcp.DstPort == 443 and tcp.PayloadLength > 0 and tcp.Payload[0] == 0x16 and tcp.Payload[1] == 0x03) or udp.DstPort == 443)";

/// Record-only filter used while focus is off: just the TCP ClientHello clause of SNI_FILTER —
/// one packet per new TLS connection, so the always-on cost is negligible (and QUIC bulk traffic
/// never touches user space when unfocused). Recording SNIs while unfocused is what lets
/// focus-on seed the taint set for pooled sockets opened *before* the session started — a pooled
/// socket never sends another ClientHello, so this is the only chance to learn its hostname
/// (see blocking-upgrade.md).
const SNI_RECORD_FILTER: &str = "outbound and tcp.DstPort == 443 and tcp.PayloadLength > 0 and tcp.Payload[0] == 0x16 and tcp.Payload[1] == 0x03";

/// How often the SNI engine and taint-drop manager poll for a focus transition (to swap/tear
/// down their handles). Cheap: only runs while idle-waiting, four times a second.
const FOCUS_POLL: Duration = Duration::from_millis(250);

/// Priority of the taint-drop handle: below the SNI/burst handles (priority 0), so they see
/// packets first and packets they *reinject* still traverse the drop filter.
const TAINT_DROP_PRIORITY: i16 = -100;

/// How often the taint-drop manager polls the taint generation. Tighter than FOCUS_POLL so a
/// taint seeded at focus-on (or on a policy change) becomes an installed DROP filter within a
/// few tens of ms — the pooled-socket window the x.com HAR exposed shrinks from ~1s to this.
/// The poll is just an atomic load + sleep, so a fast cadence is essentially free.
const TAINT_POLL: Duration = Duration::from_millis(50);

/// 443 inspection engine. Always-on: a WinDivert handle is open for the whole service lifetime,
/// but its filter tracks focus — record-only ClientHello capture when unfocused
/// (SNI_RECORD_FILTER), full inspection + QUIC capture when focused (SNI_FILTER). While focused
/// it parses each captured TCP ClientHello, records the flow's SNI (for surgical reset and
/// taint seeding), taints destinations seen serving blocked SNIs, and RSTs connections whose
/// SNI is blocked — blocking by the hostname the browser actually requests on the wire, immune
/// to CDN-shared domains, hardcoded IPs, and stale DNS. It also drops all outbound QUIC
/// (UDP 443), including sessions that were established while focus was off, forcing h3 traffic
/// onto TCP where the SNI check works (see quic-upgrade.md). While unfocused it only records
/// flow SNIs, so a later focus-on knows the hostname behind every already-open socket.
pub fn run_sni_engine(shared: Arc<EnforceShared>, shutdown: tokio::sync::watch::Receiver<bool>) {
    loop {
        if *shutdown.borrow() {
            break;
        }
        // Open with the filter matching the current focus state; reopen on every transition.
        let was_active = shared.is_active();
        let filter = if was_active {
            SNI_FILTER
        } else {
            SNI_RECORD_FILTER
        };
        let diverter = match Diverter::open(filter, 0, WinDivertFlags::new()) {
            Ok(d) => d,
            Err(e) => {
                tracing::error!("WinDivert SNI engine open failed: {e}");
                std::thread::sleep(FOCUS_POLL);
                continue;
            }
        };
        tracing::info!(
            "WinDivert SNI engine running ({})",
            if was_active {
                "blocking"
            } else {
                "record-only"
            }
        );

        // Watcher: when focus flips (or we shut down) break the blocking recv so the handle
        // tears down; the outer loop reopens it with the other filter. Mirrors the reset-burst
        // shutdown pattern. `done` lets the main loop retire the watcher (e.g. after a spurious
        // recv error) without it shutting down a handle we're already closing; we join it before
        // the handle drops, so the watcher never references a closed/reused handle.
        let done = Arc::new(AtomicBool::new(false));
        let watcher = {
            let raw = diverter.raw();
            let shared = shared.clone();
            let shutdown = shutdown.clone();
            let done = done.clone();
            std::thread::spawn(move || {
                while shared.is_active() == was_active
                    && !*shutdown.borrow()
                    && !done.load(Ordering::Relaxed)
                {
                    std::thread::sleep(FOCUS_POLL);
                }
                if !done.load(Ordering::Relaxed) {
                    unsafe {
                        let _ = WinDivertShutdown(HANDLE(raw), WinDivertShutdownMode::Recv);
                    }
                }
            })
        };

        let mut buf = vec![0u8; 65535];
        loop {
            let (n, addr) = match diverter.recv(&mut buf) {
                Ok(x) => x,
                Err(_) => break, // recv shut down (focus flipped) or drained
            };
            let data = &buf[..n];
            let consumed = handle_sni_packet(&diverter, &shared, data, &addr);
            if !consumed {
                let _ = diverter.send(data, &addr);
            }
        }
        done.store(true, Ordering::Relaxed);
        let _ = watcher.join();
        tracing::info!("WinDivert SNI engine handle closed (focus transition)");
        // `diverter` dropped here (handle closed); loop back to reopen for the new state.
    }
    tracing::info!("WinDivert SNI engine exited");
}

/// Inspect one captured outbound 443 packet. While focused, UDP (QUIC) is dropped outright; for
/// a TCP handshake, records the flow's SNI (always — even unfocused, so focus-on can seed taints
/// for already-open sockets) and, while focused, taints the destination and drops/RSTs the
/// connection if that SNI is blocked. Returns true if consumed (dropped).
fn handle_sni_packet(
    diverter: &Diverter,
    shared: &EnforceShared,
    data: &[u8],
    addr: &WINDIVERT_ADDRESS,
) -> bool {
    let active = shared.is_active();
    let Some(pkt) = parse_ip(data) else {
        return false;
    };
    if pkt.proto == PROTO_UDP {
        // QUIC. Dropping (not RSTing — UDP has no RST) starves the session; the browser marks
        // the origin h3-broken and retries over TCP. (Only captured while focused — the
        // record-only filter has no UDP clause — but gate anyway for the transition window.)
        return active
            && matches!(
                udp_ports_payload(data, pkt.l4_off),
                Some((_, PORT_HTTPS, _))
            );
    }
    if pkt.proto != PROTO_TCP {
        return false;
    }
    let Some(tcp) = tcp_fields(data, pkt.l4_off) else {
        return false;
    };
    let Some(poff) = tcp_payload_offset(data, pkt.l4_off) else {
        return false;
    };
    let Some(payload) = data.get(poff..) else {
        return false;
    };
    let Some(host) = extract_sni(payload) else {
        return false; // not a (complete) ClientHello, or ECH-encrypted SNI
    };

    // Record (local, local_port, remote, remote_port) -> SNI so a later focus-on / policy change
    // can taint and reset this flow if it is (or becomes) blocked.
    shared.record_flow_sni((pkt.src, tcp.sport, pkt.dst, tcp.dport), host.clone());

    if !active {
        return false; // record-only while unfocused
    }

    let policy = shared.policy_snapshot();
    if is_host_blocked(&policy, &host) || is_doh_bypass_host(&host) {
        // This destination provably serves blocked content — drop all further 443 egress to it
        // so pooled/coalesced sockets to it die too (taint-drop layer).
        shared.taint(pkt.dst);
        // Inject an inbound RST to the local client (appears to come from the server), seq = the
        // server's next expected seq (the ack we just observed) so the stack accepts it.
        let mut rst = build_rst(pkt.dst, pkt.src, tcp.dport, tcp.sport, tcp.ack);
        if !rst.is_empty() {
            let mut rst_addr = inbound_addr_from(addr);
            calc_checksums(&mut rst, &mut rst_addr);
            let _ = diverter.send(&rst, &rst_addr);
        }
        tracing::debug!("SNI-blocked {host}");
        return true; // drop the ClientHello so the handshake never completes
    }
    // Allowed SNI: shield this destination from tainting, and untaint it if a blanket focus-on
    // teardown (or a stale taint) had caught it — so an allowed site recovers on its next
    // handshake instead of waiting out the TTL.
    shared.note_allowed(pkt.dst);
    shared.untaint(pkt.dst);
    false // allowed → reinject
}

/// Offset of the TCP payload within the packet, honoring the data-offset field (TCP options).
fn tcp_payload_offset(data: &[u8], l4: usize) -> Option<usize> {
    let data_off = *data.get(l4 + 12)?;
    let thl = ((data_off >> 4) as usize) * 4;
    if thl < 20 {
        return None;
    }
    Some(l4 + thl)
}

// ---------------------------------------------------------------------------
// Tainted-destination drop (stateless egress block — blocking-upgrade.md)
// ---------------------------------------------------------------------------

/// Enforcement layer for the pre-armed suspect set: while focused, keeps a DROP-flag WinDivert
/// handle open whose filter silently discards outbound 443 **application-data** to in-scope
/// destinations. The DROP flag means the driver drops matching packets with no recv loop and zero
/// per-packet user-space cost — focusd's "the socket simply can't send" semantics, but learned
/// precisely (per `EnforceShared`'s taint / clean sets) rather than from a coarse pre-resolve.
///
/// **Only application-data is dropped** (`tcp.PayloadLength > 0` and not a TLS handshake record,
/// `0x16 0x03…`), plus all QUIC (UDP 443). TCP SYN/ACK and the cleartext ClientHello are *let
/// through* so the always-on SNI engine (priority 0, above this handle at -100) still adjudicates
/// every new connection: a blocked SNI is RST + tainted, an allowed SNI is `note_allowed` +
/// `untaint`ed. This is what makes a wrongly-scoped shared-CDN IP recoverable — a new allowed
/// handshake to it succeeds and clears the scope — instead of being dead for the whole TTL. A
/// pooled/coalesced socket (no new handshake) still dies, because its request frames are
/// application-data and never get out.
///
/// The filter polarity follows the mode: blacklist drops to the **tainted** set; whitelist drops
/// to everything **not** in the **clean** allow-exception set; block-all drops all 443. The
/// desired filter is recomputed each tick and the handle is reopened only when it changes (new
/// handle opened before the old is dropped, so there is no enforcement gap). On focus-off the
/// handle is dropped; `Core` owns clearing the session taint/clean sets so focus-on can pre-arm
/// them before workers observe the new active state.
pub fn run_taint_drop(shared: Arc<EnforceShared>, shutdown: tokio::sync::watch::Receiver<bool>) {
    let mut handle: Option<Diverter> = None;
    let mut installed: Option<String> = None;
    while !*shutdown.borrow() {
        if !shared.is_active() {
            if handle.take().is_some() {
                tracing::info!("taint drop disabled (focus off)");
            }
            installed = None;
            std::thread::sleep(FOCUS_POLL);
            continue;
        }
        // Recompute the desired filter each tick (cheap: small sorted vecs). tainted_ips/clean_ips
        // TTL-evict as a side effect. We only reopen the handle when the string actually changes.
        let want = build_drop_filter(shared.mode(), &shared.tainted_ips(), &shared.clean_ips());
        if want != installed {
            match &want {
                None => {
                    if handle.take().is_some() {
                        tracing::info!("taint drop cleared (nothing to drop)");
                    }
                    installed = None;
                }
                Some(filter) => {
                    match Diverter::open(
                        filter,
                        TAINT_DROP_PRIORITY,
                        WinDivertFlags::new().set_drop(),
                    ) {
                        Ok(d) => {
                            handle = Some(d); // old handle dropped only after the new one is open
                            installed = want;
                            tracing::info!("taint drop active");
                        }
                        Err(e) => {
                            // Keep the old handle; `installed` stays stale so we retry next tick.
                            tracing::warn!("taint drop open failed: {e}");
                            std::thread::sleep(FOCUS_POLL);
                            continue;
                        }
                    }
                }
            }
        }
        std::thread::sleep(TAINT_POLL);
    }
    tracing::info!("taint drop manager exited");
}

/// We drop TLS **application-data** records (content type `0x17`) — the HTTP/2 request/response
/// frames a pooled socket carries — but never TLS **handshake** records (`0x16`), so a new
/// ClientHello still reaches the SNI engine to be adjudicated (and a wrongly-scoped shared IP can
/// be exonerated). We match the app-data type *positively* because WinDivert's `not` negates only
/// a single comparison and rejects `not (...)` (a parenthesized sub-expression) — verified against
/// `WinDivertHelperCompileFilter`.
const APPDATA_MATCH: &str = "tcp.PayloadLength > 0 and tcp.Payload[0] == 0x17";

/// Build the drop filter for the current mode, or `None` when there is nothing to drop (blacklist
/// with an empty taint set). Drops only outbound 443 application-data (TCP, content-type `0x17`) +
/// all QUIC (UDP 443), scoped per mode:
///   * **Blacklist** — to the tainted destinations.
///   * **Whitelist** — to every destination *not* in the clean allow-exception set.
///   * **BlockAll** — to every destination.
fn build_drop_filter(mode: Mode, tainted: &[IpAddr], clean: &[IpAddr]) -> Option<String> {
    // `scope` is an optional extra `and (...)` clause restricting which destinations we drop to.
    // `None` means "no destination restriction" (drop to all in-scope ports).
    let scope: Option<String> = match mode {
        Mode::Blacklist => {
            if tainted.is_empty() {
                return None; // nothing proven blocked yet → no handle
            }
            Some(dst_in(tainted))
        }
        // Drop everything that is NOT a known-clean destination (empty clean → drop all).
        Mode::Whitelist => Some(dst_not_in(clean)),
        Mode::BlockAll => None, // drop all 443
    };
    let and_scope = scope.map(|s| format!(" and {s}")).unwrap_or_default();
    let tcp = format!("tcp.DstPort == 443 and {APPDATA_MATCH}{and_scope}");
    let udp = format!("udp.DstPort == 443{and_scope}");
    Some(format!("outbound and (({tcp}) or ({udp}))"))
}

/// `(ip.DstAddr == a or ipv6.DstAddr == b or …)` — destination is one of `ips`.
fn dst_in(ips: &[IpAddr]) -> String {
    let parts: Vec<String> = ips
        .iter()
        .map(|ip| match ip {
            IpAddr::V4(a) => format!("ip.DstAddr == {a}"),
            IpAddr::V6(a) => format!("ipv6.DstAddr == {a}"),
        })
        .collect();
    format!("({})", parts.join(" or "))
}

/// Destination is **not** any clean IP — family-aware, because `ip.DstAddr` doesn't exist on an
/// IPv6 packet (and vice-versa), so a naive cross-family `!=` chain would wrongly exclude the
/// other family. A v4 packet is in-scope unless its dst is a clean v4 IP; a v6 packet unless its
/// dst is a clean v6 IP. With no clean IPs of a family, all of that family is in-scope (so an
/// empty clean set drops all 443 — whitelist default-deny). Uses `!=` chains since WinDivert can't
/// negate a parenthesized set.
fn dst_not_in(clean: &[IpAddr]) -> String {
    let v4: Vec<String> = clean
        .iter()
        .filter_map(|ip| match ip {
            IpAddr::V4(a) => Some(format!("ip.DstAddr != {a}")),
            _ => None,
        })
        .collect();
    let v6: Vec<String> = clean
        .iter()
        .filter_map(|ip| match ip {
            IpAddr::V6(a) => Some(format!("ipv6.DstAddr != {a}")),
            _ => None,
        })
        .collect();
    let v4_excl = if v4.is_empty() {
        "ip".to_string()
    } else {
        format!("(ip and {})", v4.join(" and "))
    };
    let v6_excl = if v6.is_empty() {
        "ipv6".to_string()
    } else {
        format!("(ipv6 and {})", v6.join(" and "))
    };
    format!("({v4_excl} or {v6_excl})")
}

// ---------------------------------------------------------------------------
// Socket-layer connect block (VPN-transparent — see module header)
// ---------------------------------------------------------------------------

/// Priority of the SOCKET-layer connect-block handle. The socket layer is independent of the
/// network-layer handles (it intercepts socket operations, not packets), so the value is only for
/// ordering against any other socket-layer handle; we keep it distinct for clarity.
const SOCKET_PRIORITY: i16 = -50;

/// Web ports the connect-block gates on. Non-web connects (DNS/UDP 53, NTP, system services, the
/// VPN client's own tunnel, …) never match, so they are never blocked — fail-safe by construction,
/// and it keeps name resolution working so allowed sites stay reachable.
const SOCKET_WEB_SCOPE: &str =
    "((tcp and (remotePort == 80 or remotePort == 443)) or (udp and remotePort == 443))";

/// Loopback / private / link-local ranges exempted from whitelist & block-all connect blocking so
/// localhost and LAN services never break. Inclusive `(low, high)` ranges because the WinDivert
/// filter language has no CIDR notation but does support address comparisons (`<` / `>`). A single
/// `remoteAddr` field covers both families (IPv4 arrives as an IPv4-mapped IPv6 address, which sorts
/// far below the v6 ranges below), so one set of clauses is family-correct.
const SOCKET_EXEMPT_RANGES: &[(&str, &str)] = &[
    ("10.0.0.0", "10.255.255.255"),
    ("172.16.0.0", "172.31.255.255"),
    ("192.168.0.0", "192.168.255.255"),
    ("127.0.0.0", "127.255.255.255"),
    ("169.254.0.0", "169.254.255.255"),
    ("::1", "::1"),
    ("fe80::", "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff"),
    ("fc00::", "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"),
];

/// `(remoteAddr < lo or remoteAddr > hi) and …` — destination is outside every exempt range. Each
/// range is a positive parenthesized sub-expression (WinDivert can't negate a `(...)`, but it can
/// `or` two single comparisons), joined by `and` so all must hold.
fn socket_exempt_clause() -> String {
    SOCKET_EXEMPT_RANGES
        .iter()
        .map(|(lo, hi)| format!("(remoteAddr < {lo} or remoteAddr > {hi})"))
        .collect::<Vec<_>>()
        .join(" and ")
}

/// `(remoteAddr == a or remoteAddr == b or …)` — connect destination is one of `ips`. Unlike the
/// NETWORK layer, the SOCKET layer exposes one unified `remoteAddr` field for both v4 and v6, so no
/// family split is needed.
fn remote_in(ips: &[IpAddr]) -> String {
    let parts: Vec<String> = ips.iter().map(|ip| format!("remoteAddr == {ip}")).collect();
    format!("({})", parts.join(" or "))
}

/// Build the SOCKET-layer connect-block filter for the current mode, or `None` when there is
/// nothing to block (blacklist with an empty taint set). A connect that **matches** is blocked by
/// the driver at setup; one that doesn't match proceeds. Because the SOCKET layer adjudicates at
/// `connect()` — before the OS routes the packet into a VPN tunnel — the destination IP is the real
/// one, so this enforcement is VPN-transparent. Polarity mirrors `build_drop_filter`:
///   * **Blacklist** — block web connects to the tainted destinations.
///   * **Whitelist** — block web connects to everything *not* in the clean allow-exception set
///     (and not an exempt local/private range). Empty clean set ⇒ block all non-exempt web connects.
///   * **BlockAll** — block all non-exempt web connects.
fn build_socket_filter(mode: Mode, tainted: &[IpAddr], clean: &[IpAddr]) -> Option<String> {
    let mut clauses = vec!["event == CONNECT".to_string(), SOCKET_WEB_SCOPE.to_string()];
    match mode {
        Mode::Blacklist => {
            if tainted.is_empty() {
                return None; // nothing proven blocked yet → no handle
            }
            clauses.push(remote_in(tainted));
        }
        Mode::Whitelist => {
            clauses.push(socket_exempt_clause());
            for ip in clean {
                clauses.push(format!("remoteAddr != {ip}"));
            }
        }
        Mode::BlockAll => {
            clauses.push(socket_exempt_clause());
        }
    }
    Some(clauses.join(" and "))
}

/// VPN-transparent connect-block engine (SOCKET layer). While focused, keeps a SOCKET-layer handle
/// open whose filter blocks `connect()` to in-scope destinations *at connection setup* — before the
/// OS hands the packet to a VPN tunnel — so new connects are still gated even behind a full-tunnel
/// VPN, the gap the NETWORK-layer engines can't close (they see only encrypted blobs to the VPN
/// server). This does not replace `run_taint_drop`: SOCKET sees setup only; NETWORK DROP remains
/// responsible for already-open sockets on the regular path.
///
/// The SOCKET layer has no packet injection: a connect that matches the filter is blocked, one that
/// doesn't proceeds — the **filter is the entire control surface** (like `run_taint_drop`). It also
/// can't use the DROP flag (RECV_ONLY is mandatory), so we run a `recv` loop purely to **drain** the
/// queued (already-blocked) connect events; if we let the queue overflow, blocking would fail open.
///
/// The desired filter is recomputed from the live taint/clean sets; when it changes (or focus ends)
/// a watcher shuts down the blocking `recv` and the outer loop reopens with the fresh filter. On
/// focus-off the handle is dropped. Fail-safe: any open/recv error just retries — a missing handle
/// means connects pass (the persistent firewall backstop and SCM restart cover a dead service).
pub fn run_socket_engine(shared: Arc<EnforceShared>, shutdown: tokio::sync::watch::Receiver<bool>) {
    while !*shutdown.borrow() {
        if !shared.is_active() {
            std::thread::sleep(FOCUS_POLL);
            continue;
        }
        let Some(filter) =
            build_socket_filter(shared.mode(), &shared.tainted_ips(), &shared.clean_ips())
        else {
            // Nothing to block yet (blacklist, empty taint set). Re-check on the taint cadence.
            std::thread::sleep(TAINT_POLL);
            continue;
        };
        let diverter = match Diverter::open_layer(
            &filter,
            WinDivertLayer::Socket,
            SOCKET_PRIORITY,
            WinDivertFlags::new().set_recv_only(),
        ) {
            Ok(d) => d,
            Err(e) => {
                tracing::error!("WinDivert socket engine open failed: {e}");
                std::thread::sleep(FOCUS_POLL);
                continue;
            }
        };
        tracing::info!("WinDivert socket connect-block active");

        // Watcher: shut down the blocking recv when focus ends, we shut down, or the desired filter
        // changes (a taint/clean membership change) — so the outer loop reopens with the new filter.
        // We compare filter *strings* (cheap to rebuild) rather than a generation counter because
        // tainted_ips/clean_ips TTL-evict as a side effect and would race a counter. `done` retires
        // the watcher without it shutting down a handle we're already closing.
        let done = Arc::new(AtomicBool::new(false));
        let watcher = {
            let raw = diverter.raw();
            let shared = shared.clone();
            let shutdown = shutdown.clone();
            let done = done.clone();
            let installed = filter.clone();
            std::thread::spawn(move || {
                loop {
                    if *shutdown.borrow() || !shared.is_active() || done.load(Ordering::Relaxed) {
                        break;
                    }
                    let want = build_socket_filter(
                        shared.mode(),
                        &shared.tainted_ips(),
                        &shared.clean_ips(),
                    );
                    if want.as_deref() != Some(installed.as_str()) {
                        break;
                    }
                    std::thread::sleep(TAINT_POLL);
                }
                if !done.load(Ordering::Relaxed) {
                    unsafe {
                        let _ = WinDivertShutdown(HANDLE(raw), WinDivertShutdownMode::Recv);
                    }
                }
            })
        };

        // Drain loop: each event is a connect the filter already blocked; we discard it. Blocks on
        // recv (no busy-wait) until the watcher shuts it down on a refresh (recv then errors).
        while diverter.recv_event().is_ok() {}
        done.store(true, Ordering::Relaxed);
        let _ = watcher.join();
        tracing::info!("WinDivert socket engine handle closed (refresh)");
    }
    tracing::info!("WinDivert socket engine exited");
}

// ---------------------------------------------------------------------------
// Packet parsing / building (pure; unit-tested without the driver)
// ---------------------------------------------------------------------------

struct IpPkt {
    proto: u8,
    src: IpAddr,
    dst: IpAddr,
    /// Offset of the L4 (UDP/TCP) header within the packet.
    l4_off: usize,
}

/// Parse the IP header of a captured packet. IPv6 extension headers are not walked — packets
/// carrying them simply read as a non-UDP/TCP protocol and get passed through.
fn parse_ip(data: &[u8]) -> Option<IpPkt> {
    let version = data.first()? >> 4;
    if version == 4 {
        if data.len() < 20 {
            return None;
        }
        let ihl = ((data[0] & 0x0f) as usize) * 4;
        if ihl < 20 || data.len() < ihl {
            return None;
        }
        Some(IpPkt {
            proto: data[9],
            src: Ipv4Addr::new(data[12], data[13], data[14], data[15]).into(),
            dst: Ipv4Addr::new(data[16], data[17], data[18], data[19]).into(),
            l4_off: ihl,
        })
    } else if version == 6 {
        if data.len() < 40 {
            return None;
        }
        let mut s = [0u8; 16];
        let mut d = [0u8; 16];
        s.copy_from_slice(&data[8..24]);
        d.copy_from_slice(&data[24..40]);
        Some(IpPkt {
            proto: data[6],
            src: Ipv6Addr::from(s).into(),
            dst: Ipv6Addr::from(d).into(),
            l4_off: 40,
        })
    } else {
        None
    }
}

/// Returns (src_port, dst_port, payload_offset) for a UDP datagram.
fn udp_ports_payload(data: &[u8], l4: usize) -> Option<(u16, u16, usize)> {
    let h = data.get(l4..l4 + 8)?;
    Some((
        u16::from_be_bytes([h[0], h[1]]),
        u16::from_be_bytes([h[2], h[3]]),
        l4 + 8,
    ))
}

struct TcpF {
    sport: u16,
    dport: u16,
    ack: u32,
}

fn tcp_fields(data: &[u8], l4: usize) -> Option<TcpF> {
    let h = data.get(l4..l4 + 20)?;
    Some(TcpF {
        sport: u16::from_be_bytes([h[0], h[1]]),
        dport: u16::from_be_bytes([h[2], h[3]]),
        ack: u32::from_be_bytes([h[8], h[9], h[10], h[11]]),
    })
}

/// Build an IP+UDP packet (checksums zeroed; WinDivert recomputes them on send).
fn build_udp_reply(
    src: IpAddr,
    dst: IpAddr,
    src_port: u16,
    dst_port: u16,
    payload: &[u8],
) -> Vec<u8> {
    let udp_len = 8 + payload.len();
    let mut out = Vec::with_capacity(40 + udp_len);
    match (src, dst) {
        (IpAddr::V4(s), IpAddr::V4(d)) => {
            let total = 20 + udp_len;
            out.extend_from_slice(&[0x45, 0x00]);
            out.extend_from_slice(&(total as u16).to_be_bytes());
            out.extend_from_slice(&[0, 0, 0, 0]); // id, flags/frag
            out.push(64); // ttl
            out.push(PROTO_UDP);
            out.extend_from_slice(&[0, 0]); // header checksum
            out.extend_from_slice(&s.octets());
            out.extend_from_slice(&d.octets());
        }
        (IpAddr::V6(s), IpAddr::V6(d)) => {
            out.extend_from_slice(&[0x60, 0, 0, 0]); // version/traffic class/flow label
            out.extend_from_slice(&(udp_len as u16).to_be_bytes()); // payload length
            out.push(PROTO_UDP); // next header
            out.push(64); // hop limit
            out.extend_from_slice(&s.octets());
            out.extend_from_slice(&d.octets());
        }
        _ => return Vec::new(),
    }
    out.extend_from_slice(&src_port.to_be_bytes());
    out.extend_from_slice(&dst_port.to_be_bytes());
    out.extend_from_slice(&(udp_len as u16).to_be_bytes());
    out.extend_from_slice(&[0, 0]); // udp checksum
    out.extend_from_slice(payload);
    out
}

/// Build an IP + 20-byte-TCP segment with no payload and the given flags (checksums zeroed for
/// WinDivert to recompute). Used for both RSTs and the inbound SYN probes.
fn build_tcp(
    src: IpAddr,
    dst: IpAddr,
    src_port: u16,
    dst_port: u16,
    seq: u32,
    ack: u32,
    flags: u8,
) -> Vec<u8> {
    let mut out = Vec::with_capacity(60);
    match (src, dst) {
        (IpAddr::V4(s), IpAddr::V4(d)) => {
            out.extend_from_slice(&[0x45, 0x00]);
            out.extend_from_slice(&(40u16).to_be_bytes()); // total length: 20 IP + 20 TCP
            out.extend_from_slice(&[0, 0, 0, 0]);
            out.push(64);
            out.push(PROTO_TCP);
            out.extend_from_slice(&[0, 0]);
            out.extend_from_slice(&s.octets());
            out.extend_from_slice(&d.octets());
        }
        (IpAddr::V6(s), IpAddr::V6(d)) => {
            out.extend_from_slice(&[0x60, 0, 0, 0]);
            out.extend_from_slice(&(20u16).to_be_bytes()); // payload length: 20 TCP
            out.push(PROTO_TCP);
            out.push(64);
            out.extend_from_slice(&s.octets());
            out.extend_from_slice(&d.octets());
        }
        _ => return Vec::new(),
    }
    out.extend_from_slice(&src_port.to_be_bytes());
    out.extend_from_slice(&dst_port.to_be_bytes());
    out.extend_from_slice(&seq.to_be_bytes());
    out.extend_from_slice(&ack.to_be_bytes());
    out.push(0x50); // data offset = 5 words, reserved = 0
    out.push(flags);
    out.extend_from_slice(&[0, 0]); // window
    out.extend_from_slice(&[0, 0]); // checksum
    out.extend_from_slice(&[0, 0]); // urgent pointer
    out
}

/// Convenience for the RST case (no ACK flag/number needed; seq must be in-window). Used by the
/// SNI engine to tear down a blocked new connection's handshake.
fn build_rst(src: IpAddr, dst: IpAddr, src_port: u16, dst_port: u16, seq: u32) -> Vec<u8> {
    build_tcp(src, dst, src_port, dst_port, seq, 0, TCP_FLAG_RST)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ipv4_udp() {
        // 20-byte IPv4 (proto 17) + 8-byte UDP, dst port 53.
        let mut p = vec![
            0x45, 0, 0, 28, 0, 0, 0, 0, 64, 17, 0, 0, 10, 0, 0, 1, 1, 1, 1, 1,
        ];
        p.extend_from_slice(&[0xab, 0xcd, 0, 53, 0, 8, 0, 0]); // sport 0xabcd, dport 53
        let pkt = parse_ip(&p).unwrap();
        assert_eq!(pkt.proto, PROTO_UDP);
        assert_eq!(pkt.l4_off, 20);
        let (sport, dport, off) = udp_ports_payload(&p, pkt.l4_off).unwrap();
        assert_eq!((sport, dport, off), (0xabcd, 53, 28));
    }

    #[test]
    fn parses_ipv6_tcp() {
        let mut p = vec![0x60, 0, 0, 0, 0, 20, 6, 64];
        p.extend_from_slice(&[0; 16]); // src
        p.extend_from_slice(&[0; 16]); // dst
        p.extend_from_slice(&[0x10, 0x00, 0x03, 0x55]); // sport 0x1000, dport 853
        p.extend_from_slice(&[0, 0, 0, 0]); // seq
        p.extend_from_slice(&[0xde, 0xad, 0xbe, 0xef]); // ack
        p.extend_from_slice(&[0x50, 0x18, 0, 0, 0, 0, 0, 0]);
        let pkt = parse_ip(&p).unwrap();
        assert_eq!(pkt.proto, PROTO_TCP);
        assert_eq!(pkt.l4_off, 40);
        let tcp = tcp_fields(&p, pkt.l4_off).unwrap();
        assert_eq!((tcp.sport, tcp.dport, tcp.ack), (0x1000, 853, 0xdeadbeef));
    }

    #[test]
    fn udp_reply_lengths_and_swap() {
        let src: IpAddr = Ipv4Addr::new(1, 1, 1, 1).into();
        let dst: IpAddr = Ipv4Addr::new(10, 0, 0, 1).into();
        let payload = [0u8; 12];
        let out = build_udp_reply(src, dst, 53, 0xabcd, &payload);
        assert_eq!(out.len(), 20 + 8 + 12);
        assert_eq!(u16::from_be_bytes([out[2], out[3]]), 40); // IP total length
        assert_eq!(&out[12..16], &[1, 1, 1, 1]); // src
        assert_eq!(&out[16..20], &[10, 0, 0, 1]); // dst
        assert_eq!(u16::from_be_bytes([out[20], out[21]]), 53); // udp sport
        assert_eq!(u16::from_be_bytes([out[22], out[23]]), 0xabcd); // udp dport
    }

    #[test]
    fn rst_is_well_formed() {
        let src: IpAddr = Ipv6Addr::LOCALHOST.into();
        let dst: IpAddr = Ipv6Addr::LOCALHOST.into();
        let out = build_rst(src, dst, 443, 0x1000, 0x11223344);
        assert_eq!(out.len(), 40 + 20);
        assert_eq!(out[6], PROTO_TCP); // next header
        let tcp = &out[40..];
        assert_eq!(u16::from_be_bytes([tcp[0], tcp[1]]), 443);
        assert_eq!(
            u32::from_be_bytes([tcp[4], tcp[5], tcp[6], tcp[7]]),
            0x11223344
        );
        assert_eq!(tcp[13], 0x04); // RST flag
    }

    #[test]
    fn engine_filter_exempts_resolver_src_port() {
        let f = engine_filter();
        assert!(f.contains(&format!("udp.SrcPort != {RESOLVER_SRC_PORT}")));
        assert!(f.contains(&format!("tcp.SrcPort != {RESOLVER_SRC_PORT}")));
        assert!(f.contains("udp.DstPort == 53"));
        assert!(f.contains("tcp.DstPort == 853"));
    }

    #[test]
    fn blacklist_drop_filter_scopes_to_tainted_and_exempts_clienthello() {
        let ips = [
            Ipv4Addr::new(151, 101, 1, 140).into(),
            Ipv6Addr::LOCALHOST.into(),
        ];
        let f = build_drop_filter(Mode::Blacklist, &ips, &[]).unwrap();
        assert!(f.contains("ip.DstAddr == 151.101.1.140"));
        assert!(f.contains("ipv6.DstAddr == ::1"));
        // App-data only: payload-bearing TLS application_data (0x17), so handshakes pass through.
        assert!(f.contains("tcp.Payload[0] == 0x17"));
        assert!(!f.contains("not "));
        assert!(f.contains("udp.DstPort == 443"));
        assert!(f.starts_with("outbound and ("));
    }

    #[test]
    fn blacklist_empty_taint_set_means_no_handle() {
        assert!(build_drop_filter(Mode::Blacklist, &[], &[]).is_none());
    }

    #[test]
    fn whitelist_drop_filter_excludes_clean_set_per_family() {
        let clean = [
            Ipv4Addr::new(142, 250, 0, 1).into(),
            Ipv6Addr::new(0x2607, 0xf8b0, 0, 0, 0, 0, 0, 1).into(),
        ];
        let f = build_drop_filter(Mode::Whitelist, &[], &clean).unwrap();
        // Drop everything NOT in the clean set, family-aware (!= chains, no parenthesized `not`).
        assert!(f.contains("ip.DstAddr != 142.250.0.1"));
        assert!(f.contains("ipv6.DstAddr != 2607:f8b0::1"));
        assert!(!f.contains("not "));
        assert!(f.contains("tcp.Payload[0] == 0x17"));
    }

    #[test]
    fn whitelist_empty_clean_set_drops_all() {
        let f = build_drop_filter(Mode::Whitelist, &[], &[]).unwrap();
        // No clean exception → all v4 + v6 in scope (drop all 443 app-data + QUIC).
        assert!(!f.contains("DstAddr"));
        assert!(f.contains("(ip or ipv6)"));
        assert!(f.contains("udp.DstPort == 443"));
    }

    #[test]
    fn block_all_drops_all_443() {
        let f = build_drop_filter(Mode::BlockAll, &[], &[]).unwrap();
        assert!(!f.contains("DstAddr"));
        assert!(f.contains("tcp.Payload[0] == 0x17"));
        assert!(f.contains("udp.DstPort == 443"));
    }

    #[test]
    fn network_drop_remains_data_plane_backstop() {
        let clean = [Ipv4Addr::new(142, 250, 0, 1).into()];
        let f = build_drop_filter(Mode::Whitelist, &[], &clean).unwrap();

        // This is the pre-existing/pooled-socket killer: a NETWORK-layer DROP filter on outbound
        // app-data/QUIC packets. The SOCKET layer must stay additive, not replace this path.
        assert!(f.starts_with("outbound and"));
        assert!(f.contains("tcp.Payload[0] == 0x17"));
        assert!(f.contains("udp.DstPort == 443"));
        assert!(f.contains("ip.DstAddr != 142.250.0.1"));
        assert!(!f.contains("event == CONNECT"));
        assert!(!f.contains("remoteAddr"));
    }

    #[test]
    fn socket_connect_filter_does_not_weaken_network_drop_scope() {
        let network = build_drop_filter(Mode::Whitelist, &[], &[]).unwrap();
        let socket = build_socket_filter(Mode::Whitelist, &[], &[]).unwrap();

        // The old IP-first path remains strict: empty whitelist clean set means drop all 443
        // app-data/QUIC at NETWORK. Local/private exemptions are only for new CONNECT blocking.
        assert!(network.contains("(ip or ipv6)"));
        assert!(!network.contains("10.0.0.0"));
        assert!(!network.contains("remoteAddr"));

        assert!(socket.contains("event == CONNECT"));
        assert!(socket.contains("(remoteAddr < 10.0.0.0 or remoteAddr > 10.255.255.255)"));
        assert!(!socket.contains("ip.DstAddr"));
        assert!(!socket.contains("tcp.Payload[0]"));
    }

    /// Validate every drop-filter variant against WinDivert's own compiler (no driver/admin
    /// needed) — this is what `WinDivertOpen` checks and was rejecting with os error 87.
    fn assert_windivert_compiles(filter: &str) {
        use std::ffi::{CStr, CString};
        let c = CString::new(filter).unwrap();
        let mut err_str: *const std::os::raw::c_char = std::ptr::null();
        let mut err_pos: u32 = 0;
        let ok = unsafe {
            windivert_sys::WinDivertHelperCompileFilter(
                c.as_ptr(),
                WinDivertLayer::Network,
                std::ptr::null_mut(),
                0,
                &mut err_str,
                &mut err_pos,
            )
        };
        if !ok.as_bool() {
            let msg = if err_str.is_null() {
                "<null>".to_string()
            } else {
                unsafe { CStr::from_ptr(err_str) }
                    .to_string_lossy()
                    .into_owned()
            };
            panic!("WinDivert rejected filter at pos {err_pos}: {msg}\n  filter: {filter}");
        }
    }

    #[test]
    fn all_filters_compile_in_windivert() {
        let v4: IpAddr = Ipv4Addr::new(1, 2, 3, 4).into();
        let v6: IpAddr = Ipv6Addr::new(0x2606, 0x4700, 0, 0, 0, 0, 0, 1).into();
        let mixed = [v4, v6];
        assert_windivert_compiles(&build_drop_filter(Mode::Blacklist, &mixed, &[]).unwrap());
        assert_windivert_compiles(&build_drop_filter(Mode::Whitelist, &[], &mixed).unwrap());
        assert_windivert_compiles(&build_drop_filter(Mode::Whitelist, &[], &[v4]).unwrap());
        assert_windivert_compiles(&build_drop_filter(Mode::Whitelist, &[], &[]).unwrap());
        assert_windivert_compiles(&build_drop_filter(Mode::BlockAll, &[], &[]).unwrap());
        assert_windivert_compiles(&engine_filter());
        // The always-on engine filters too, so a syntax regression is caught here.
        assert_windivert_compiles(SNI_FILTER);
        assert_windivert_compiles(SNI_RECORD_FILTER);
    }

    /// Compile a filter against WinDivert's own compiler at a specific layer (the socket-layer
    /// fields `event`/`remoteAddr`/`remotePort` are only valid at the SOCKET layer).
    fn assert_compiles_at(filter: &str, layer: WinDivertLayer) {
        use std::ffi::{CStr, CString};
        let c = CString::new(filter).unwrap();
        let mut err_str: *const std::os::raw::c_char = std::ptr::null();
        let mut err_pos: u32 = 0;
        let ok = unsafe {
            windivert_sys::WinDivertHelperCompileFilter(
                c.as_ptr(),
                layer,
                std::ptr::null_mut(),
                0,
                &mut err_str,
                &mut err_pos,
            )
        };
        if !ok.as_bool() {
            let msg = if err_str.is_null() {
                "<null>".to_string()
            } else {
                unsafe { CStr::from_ptr(err_str) }
                    .to_string_lossy()
                    .into_owned()
            };
            panic!("WinDivert rejected socket filter at pos {err_pos}: {msg}\n  filter: {filter}");
        }
    }

    #[test]
    fn blacklist_socket_filter_blocks_connect_to_tainted() {
        let ips = [
            Ipv4Addr::new(151, 101, 1, 140).into(),
            Ipv6Addr::LOCALHOST.into(),
        ];
        let f = build_socket_filter(Mode::Blacklist, &ips, &[]).unwrap();
        assert!(f.starts_with("event == CONNECT and"));
        assert!(f.contains("remoteAddr == 151.101.1.140"));
        assert!(f.contains("remoteAddr == ::1"));
        assert!(f.contains("remotePort == 443"));
        // Blacklist scopes to the taint set — no private-range exemption clause.
        assert!(!f.contains("remoteAddr <"));
    }

    #[test]
    fn blacklist_socket_empty_taint_means_no_handle() {
        assert!(build_socket_filter(Mode::Blacklist, &[], &[]).is_none());
    }

    #[test]
    fn whitelist_socket_filter_excludes_clean_and_exempts_private() {
        let clean = [
            Ipv4Addr::new(142, 250, 0, 1).into(),
            Ipv6Addr::new(0x2607, 0xf8b0, 0, 0, 0, 0, 0, 1).into(),
        ];
        let f = build_socket_filter(Mode::Whitelist, &[], &clean).unwrap();
        assert!(f.contains("remoteAddr != 142.250.0.1"));
        assert!(f.contains("remoteAddr != 2607:f8b0::1"));
        // Local/private ranges are exempted so LAN/localhost never break.
        assert!(f.contains("(remoteAddr < 10.0.0.0 or remoteAddr > 10.255.255.255)"));
        assert!(f.contains("(remoteAddr < 127.0.0.0 or remoteAddr > 127.255.255.255)"));
        // WinDivert can't negate a parenthesized set; we only use single-term `!=`/`<`/`>`.
        assert!(!f.contains("not "));
    }

    #[test]
    fn whitelist_socket_empty_clean_blocks_all_nonexempt() {
        let f = build_socket_filter(Mode::Whitelist, &[], &[]).unwrap();
        assert!(!f.contains("remoteAddr !="));
        assert!(!f.contains("remoteAddr =="));
        assert!(f.contains("(remoteAddr < 10.0.0.0 or remoteAddr > 10.255.255.255)"));
    }

    #[test]
    fn block_all_socket_filter_blocks_all_nonexempt_web() {
        let f = build_socket_filter(Mode::BlockAll, &[], &[]).unwrap();
        assert!(!f.contains("remoteAddr =="));
        assert!(!f.contains("remoteAddr !="));
        assert!(f.contains("event == CONNECT"));
        assert!(f.contains("remotePort == 443"));
        assert!(f.contains("(remoteAddr < ::1 or remoteAddr > ::1)"));
    }

    #[test]
    fn all_socket_filters_compile_in_windivert() {
        let v4: IpAddr = Ipv4Addr::new(1, 2, 3, 4).into();
        let v6: IpAddr = Ipv6Addr::new(0x2606, 0x4700, 0, 0, 0, 0, 0, 1).into();
        let mixed = [v4, v6];
        assert_compiles_at(
            &build_socket_filter(Mode::Blacklist, &mixed, &[]).unwrap(),
            WinDivertLayer::Socket,
        );
        assert_compiles_at(
            &build_socket_filter(Mode::Whitelist, &[], &mixed).unwrap(),
            WinDivertLayer::Socket,
        );
        assert_compiles_at(
            &build_socket_filter(Mode::Whitelist, &[], &[]).unwrap(),
            WinDivertLayer::Socket,
        );
        assert_compiles_at(
            &build_socket_filter(Mode::BlockAll, &[], &[]).unwrap(),
            WinDivertLayer::Socket,
        );
    }
}
