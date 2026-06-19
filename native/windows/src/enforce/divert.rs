//! WinDivert packet engine (architecture §4.1). This is the consolidated replacement for the
//! old loopback DNS sinkhole + PowerShell adapter-DNS repointing + reassert task. One
//! always-running OS thread owns a WinDivert NETWORK-layer handle and, while focus is active:
//!
//!   * intercepts outbound DNS (UDP/53), answers blocked names with dnsmasq-style sinkhole
//!     addresses, and answers DoH bootstrap hostnames with NXDOMAIN by injecting a spoofed reply
//!     and dropping the original query;
//!   * drops outbound DNS-over-TLS/QUIC (port 853);
//!   * passes everything else through unchanged.
//!
//! Because we filter by destination *port* (not by adapter DNS settings), this also catches
//! apps that hard-code a resolver IP — the gap the old adapter-repointing approach left open.
//! No system DNS configuration is mutated.
//!
//! The actual website *blocking* is a separate, focusd-style stateless IP drop (`run_ip_drop`): a
//! DROP-flag WinDivert handle whose filter discards outbound packets to the blocked-IP set the
//! resolver maintains (enforce::resolve). No connection inspection, no reset handle, no SNI — see
//! `build_drop_filter`.
//!
//! Anti-tamper note: WinDivert blocking only holds while this process runs. If the service is
//! killed, domain blocking lapses until the SCM restarts us (~1s); the persistent Windows
//! Firewall rules in `enforce::wfp` (DoT + DoH-IP + QUIC) are the backstop. True kill-resistant
//! blocking is the deferred kernel-WFP callout.

use std::ffi::{c_void, CString};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::sync::Arc;
use std::time::Duration;

use windivert_sys::address::WINDIVERT_ADDRESS;
use windivert_sys::{
    ChecksumFlags, WinDivertClose, WinDivertFlags, WinDivertHelperCalcChecksums, WinDivertLayer,
    WinDivertOpen, WinDivertRecv, WinDivertSend,
};
use windivert_win::Win32::Foundation::HANDLE;

use crate::enforce::dns::{
    nodata_reply, nxdomain_reply, qtype, read_qname, sinkhole_address_reply, QTYPE_HTTPS,
    QTYPE_SVCB,
};
use crate::enforce::resolve::RESOLVER_SRC_PORT;
use crate::enforce::EnforceShared;
use crate::model::{Mode, Policy};
use crate::policy_match::{is_doh_bypass_host, is_host_blocked};

const PROTO_TCP: u8 = 6;
const PROTO_UDP: u8 = 17;
const PORT_DNS: u16 = 53;
const PORT_DOT: u16 = 853;

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
        let cfilter = CString::new(filter)
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "filter has NUL"))?;
        let handle =
            unsafe { WinDivertOpen(cfilter.as_ptr(), WinDivertLayer::Network, priority, flags) };
        if handle.0 == 0 || handle.0 == -1 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(Self { handle })
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
/// warm resolver (enforce::resolve) binds a fixed local source port; we exclude it so the
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
                    if is_doh_bypass_host(&name) {
                        tracing::debug!("sinkholed {name}");
                        let reply = nxdomain_reply(payload, qend);
                        return inject_dns_reply(diverter, &pkt, sport, dport, &reply, addr);
                    }
                    if is_host_blocked(policy, &name) {
                        tracing::debug!("sinkholed {name}");
                        let reply = sinkhole_address_reply(payload, qend)
                            .unwrap_or_else(|| nodata_reply(payload, qend));
                        return inject_dns_reply(diverter, &pkt, sport, dport, &reply, addr);
                    }
                    // Refuse HTTPS/SVCB records so a browser falls back to plain A/AAAA resolution,
                    // which our sinkhole sees (and NXDOMAINs if blocked) — an HTTPS RR could
                    // otherwise carry ipv4hint/ipv6hint addresses that skip a separate A query.
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
// focusd-style stateless IP drop (the website blocker)
// ---------------------------------------------------------------------------

/// How often the IP-drop manager polls for a focus transition (to tear down / set up its handle)
/// while idle. Cheap: a few times a second.
const FOCUS_POLL: Duration = Duration::from_millis(250);

/// Priority of the drop handle: below the DNS engine (priority 0), so the engine sees packets
/// first and anything it reinjects still traverses the drop filter.
const IP_DROP_PRIORITY: i16 = -100;

/// How often the IP-drop manager rebuilds its desired filter from the live IP sets. Tighter than
/// FOCUS_POLL so a resolver swap becomes an installed DROP filter within a few tens of ms. Each
/// tick is a couple of locked reads + a string compare — essentially free.
const IP_DROP_POLL: Duration = Duration::from_millis(50);

/// The website blocker (focusd's `output`-hook nftables drop, in WinDivert form). While focused,
/// keeps a DROP-flag handle open whose filter silently discards outbound packets to the blocked-IP
/// set the resolver maintains — every socket, pooled or fresh, regardless of SNI/DNS, exactly like
/// focusd's stateless `dst-ip ∈ set → drop`. Blacklist drops the resolved blocked set. Whitelist
/// and block-all default-deny web egress, sparing only the resolved allowed set in whitelist mode.
///
/// The desired filter is recomputed each tick and the handle reopened only when it changes (new
/// handle opened before the old is dropped, so there's no enforcement gap). On focus-off the handle
/// is dropped, but the resolver keeps the IP bank warm for the next session.
pub fn run_ip_drop(shared: Arc<EnforceShared>, shutdown: tokio::sync::watch::Receiver<bool>) {
    let mut handle: Option<Diverter> = None;
    let mut installed: Option<String> = None;
    while !*shutdown.borrow() {
        if !shared.is_active() {
            if handle.take().is_some() {
                tracing::info!("IP drop disabled (focus off)");
            }
            installed = None;
            std::thread::sleep(FOCUS_POLL);
            continue;
        }
        // What each mode needs: blacklist drops the resolved blocked set; whitelist spares the
        // resolved allowed set; block-all needs neither.
        let mode = shared.mode();
        let (blocked, allowed) = match mode {
            Mode::Blacklist => (shared.blocked_ips(), Vec::new()),
            Mode::Whitelist => (Vec::new(), shared.allowed_ips()),
            Mode::BlockAll => (Vec::new(), Vec::new()),
        };
        let want = build_drop_filter(mode, &blocked, &allowed);
        if want != installed {
            match &want {
                None => {
                    if handle.take().is_some() {
                        tracing::info!("IP drop cleared (nothing to drop)");
                    }
                    installed = None;
                }
                Some(filter) => {
                    match Diverter::open(filter, IP_DROP_PRIORITY, WinDivertFlags::new().set_drop())
                    {
                        Ok(d) => {
                            handle = Some(d); // old handle dropped only after the new one is open
                            installed = want;
                            tracing::info!("IP drop active");
                        }
                        Err(e) => {
                            // Keep the old handle; `installed` stays stale so we retry next tick.
                            tracing::warn!("IP drop open failed: {e}");
                            std::thread::sleep(FOCUS_POLL);
                            continue;
                        }
                    }
                }
            }
        }
        std::thread::sleep(IP_DROP_POLL);
    }
    tracing::info!("IP drop manager exited");
}

/// Web egress we can safely default-deny in whitelist/block-all without cutting DNS, LAN, native
/// messaging, or OS background plumbing. Blacklist drops are stricter and key on destination IP
/// without a port predicate, mirroring focusd's nftables destination-IP set.
const WEB_EGRESS_SCOPE: &str =
    "((tcp and (tcp.DstPort == 80 or tcp.DstPort == 443)) or (udp and udp.DstPort == 443))";

/// Build the focusd-style IP drop filter for the current mode, or `None` when blacklist mode has no
/// blocked destination IPs yet (resolver has not produced any). Blacklist drops every outbound
/// packet to a `blocked` destination. Whitelist and block-all default-deny web egress, sparing the
/// resolved `allowed` set in whitelist mode.
fn build_drop_filter(mode: Mode, blocked: &[IpAddr], allowed: &[IpAddr]) -> Option<String> {
    let scope = match mode {
        Mode::Blacklist => {
            if blocked.is_empty() {
                return None; // nothing blocked yet -> no handle
            }
            dst_in(blocked)
        }
        // Drop web egress that is NOT to an allowed destination (empty -> drop all web).
        Mode::Whitelist => format!("({WEB_EGRESS_SCOPE} and {})", dst_not_in(allowed)),
        Mode::BlockAll => WEB_EGRESS_SCOPE.to_string(),
    };
    Some(format!("outbound and {scope}"))
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
    dport: u16,
}

fn tcp_fields(data: &[u8], l4: usize) -> Option<TcpF> {
    let h = data.get(l4..l4 + 20)?;
    Some(TcpF {
        dport: u16::from_be_bytes([h[2], h[3]]),
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
        assert_eq!(tcp.dport, 853);
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
    fn engine_filter_exempts_resolver_src_port() {
        let f = engine_filter();
        assert!(f.contains(&format!("udp.SrcPort != {RESOLVER_SRC_PORT}")));
        assert!(f.contains(&format!("tcp.SrcPort != {RESOLVER_SRC_PORT}")));
        assert!(f.contains("udp.DstPort == 53"));
        assert!(f.contains("tcp.DstPort == 853"));
    }

    #[test]
    fn blacklist_drop_filter_is_focusd_style_ip_drop() {
        let ips = [
            Ipv4Addr::new(151, 101, 1, 140).into(),
            Ipv6Addr::LOCALHOST.into(),
        ];
        let f = build_drop_filter(Mode::Blacklist, &ips, &[]).unwrap();
        assert!(f.contains("ip.DstAddr == 151.101.1.140"));
        assert!(f.contains("ipv6.DstAddr == ::1"));
        assert!(!f.contains("tcp.Payload"));
        assert!(!f.contains("tcp.DstPort"));
        assert!(!f.contains("udp.DstPort"));
        assert!(!f.contains("not "));
        assert!(f.starts_with("outbound and "));
    }

    #[test]
    fn blacklist_empty_blocked_set_means_no_handle() {
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
        assert!(f.contains("tcp.DstPort == 80"));
        assert!(f.contains("tcp.DstPort == 443"));
        assert!(f.contains("udp.DstPort == 443"));
        assert!(!f.contains("tcp.Payload"));
    }

    #[test]
    fn whitelist_empty_clean_set_drops_all_web_egress() {
        let f = build_drop_filter(Mode::Whitelist, &[], &[]).unwrap();
        // No clean exception -> all v4 + v6 web egress is in scope.
        assert!(!f.contains("DstAddr"));
        assert!(f.contains("(ip or ipv6)"));
        assert!(f.contains("tcp.DstPort == 80"));
        assert!(f.contains("tcp.DstPort == 443"));
        assert!(f.contains("udp.DstPort == 443"));
    }

    #[test]
    fn block_all_drops_all_web_egress() {
        let f = build_drop_filter(Mode::BlockAll, &[], &[]).unwrap();
        assert!(!f.contains("DstAddr"));
        assert!(f.contains("tcp.DstPort == 80"));
        assert!(f.contains("tcp.DstPort == 443"));
        assert!(f.contains("udp.DstPort == 443"));
        assert!(!f.contains("tcp.Payload"));
    }

    #[test]
    fn network_drop_remains_the_only_ip_backstop() {
        let clean = [Ipv4Addr::new(142, 250, 0, 1).into()];
        let f = build_drop_filter(Mode::Whitelist, &[], &clean).unwrap();

        // This is the pre-existing/pooled-socket killer: a NETWORK-layer DROP filter.
        assert!(f.starts_with("outbound and"));
        assert!(f.contains("udp.DstPort == 443"));
        assert!(f.contains("ip.DstAddr != 142.250.0.1"));
        assert!(!f.contains("event == CONNECT"));
        assert!(!f.contains("remoteAddr"));
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
    }
}
