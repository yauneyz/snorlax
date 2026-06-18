//! Warm policy-domain resolver (architecture §4.1, IP-first blocking).
//!
//! This is the **sole source** of the drop-set IPs, exactly as in the Linux sibling `focusd`
//! (`internal/resolver/resolver.go` + `internal/daemon/daemon.go`): resolve the policy's domains to
//! their A/AAAA IPs ourselves and hand the full set to the IP-drop layer, replacing it wholesale
//! each pass (focusd's atomic nftables set swap). No SNI inspection, no learned allow store — an
//! IP is blocked iff a blocked domain currently resolves to it. The resolver runs while focus is
//! off too, so focus-on can arm against an already-populated IP bank instead of waiting for DNS.
//!
//! Two integration constraints drive the hand-rolled UDP client (rather than a resolver crate):
//!
//!   1. **It must bypass our own sinkhole.** `enforce::divert::run_engine` intercepts outbound
//!      :53 by *name* and answers NXDOMAIN for blocked names — including, naively, our own
//!      lookups. We bind to a fixed local source port (`RESOLVER_SRC_PORT`) and the engine filter
//!      excludes that source port, so our queries pass through untouched while every other app's
//!      DNS is still sinkholed.
//!   2. **It must not use the OS resolver** (which our sinkhole would also poison). We query
//!      pinned public upstreams directly over UDP/53, exactly as `focusd` does.

use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, UdpSocket};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::enforce::{EnforceShared, ResolvedClass};
use crate::model::Mode;

/// Fixed local UDP source port our resolver binds to. `enforce::divert::ENGINE_FILTER` excludes
/// this port so the sinkhole never captures our own queries while focus is active.
pub const RESOLVER_SRC_PORT: u16 = 5354;

/// Public fallback resolvers (UDP/53), tried only if the OS-configured DNS servers are unreachable
/// or return nothing. We prefer the **system** resolvers (see `effective_upstreams`) because a CDN
/// answers based on the *resolver's* network location: the browser uses the OS resolver, so to
/// block the same anycast POP IPs the browser actually connects to, we must resolve through the
/// same servers. Hardcoding 1.1.1.1 made us resolve a *different* Fastly POP than the browser, so
/// the IP we blocked never matched the IP the browser used.
const FALLBACK_UPSTREAMS: &[&str] = &["1.1.1.1:53", "8.8.8.8:53", "1.0.0.1:53", "9.9.9.9:53"];

const QTYPE_A: u16 = 1;
const QTYPE_AAAA: u16 = 28;
const QUERY_TIMEOUT: Duration = Duration::from_millis(1500);

/// How often the background resolver re-resolves the policy's domains. CDN IPs rotate, so this
/// refreshes the blocked/allowed sets on a cadence — focusd uses the same interval-based approach.
const RESOLVE_INTERVAL: Duration = Duration::from_secs(300);

/// Resolve the policy's relevant domains and replace the drop-set IPs wholesale (focusd's atomic
/// swap): in blacklist mode the blocked set, in whitelist mode the allowed set. Runs regardless of
/// focus so the IP bank stays warm. Blocking; call from a dedicated thread or one-shot kick.
pub fn resolve_and_ingest(shared: &EnforceShared) {
    let targets = shared.resolver_targets();
    if targets.is_empty() {
        match shared.mode() {
            Mode::Blacklist => shared.set_blocked_ips(HashSet::new()),
            Mode::Whitelist => shared.set_allowed_ips(HashSet::new()),
            Mode::BlockAll => {}
        }
        return;
    }
    let pairs = resolve_hosts(&targets);
    tracing::info!(
        "resolver: {} host→ip pairs for {} domains",
        pairs.len(),
        targets.len()
    );
    // Build the full set this pass, then swap it in (focusd UpdateRulesAtomic). An empty result
    // (all upstreams timed out) leaves the previous set untouched rather than unblocking.
    if pairs.is_empty() {
        return;
    }
    let mut blocked = HashSet::new();
    let mut allowed = HashSet::new();
    for (host, ip) in pairs {
        match shared.classify_resolved(&host) {
            ResolvedClass::Blocked => {
                blocked.insert(ip);
            }
            ResolvedClass::Allowed => {
                allowed.insert(ip);
            }
            ResolvedClass::Ignore => {}
        }
    }
    match shared.mode() {
        Mode::Blacklist => shared.set_blocked_ips(blocked),
        Mode::Whitelist => shared.set_allowed_ips(allowed),
        Mode::BlockAll => {}
    }
}

/// Background resolver ticker: an initial pass, then every `RESOLVE_INTERVAL`, until shutdown.
/// Runs on its own OS thread (the UDP client is blocking), mirroring the divert engines.
pub fn run_resolver(shared: Arc<EnforceShared>, shutdown: tokio::sync::watch::Receiver<bool>) {
    let mut next = Instant::now();
    while !*shutdown.borrow() {
        if Instant::now() >= next {
            resolve_and_ingest(&shared);
            next = Instant::now() + RESOLVE_INTERVAL;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    tracing::info!("resolver ticker exited");
}

/// Resolve each host's A + AAAA records, returning `(host, ip)` pairs (deduped per host by the
/// caller's set). Best-effort: a bind failure or all-upstreams-timeout yields an empty result, in
/// which case the caller leaves the previous drop set in place. Blocking; call from a dedicated
/// thread.
///
/// Each target is expanded to the bare name **and its `www.` variant** (focusd's `GetDomainVariants`
/// / `Resolve`). A CDN routinely serves `www.<host>` from a *different* anycast IP than the apex,
/// and the browser connects to `www.` — so without this the apex IP we'd block never matches the IP
/// the browser actually uses. Resolving the `www.` variant captures it (and, since a CDN co-locates
/// many of a customer's hostnames on those same IPs, covers the other subdomains too).
pub fn resolve_hosts(hosts: &[String]) -> Vec<(String, IpAddr)> {
    if hosts.is_empty() {
        return Vec::new();
    }
    let sock = match bind_socket() {
        Some(s) => s,
        None => return Vec::new(),
    };
    let _ = sock.set_read_timeout(Some(QUERY_TIMEOUT));
    let upstreams = effective_upstreams();
    let mut txid: u16 = rand::random();
    let mut out = Vec::new();
    for name in expand_www_variants(hosts) {
        for qtype in [QTYPE_A, QTYPE_AAAA] {
            txid = txid.wrapping_add(1);
            for ip in query_one(&sock, &name, qtype, txid, &upstreams) {
                out.push((name.clone(), ip));
            }
        }
    }
    out
}

/// The resolver upstreams to try, in order: the **OS-configured DNS servers** first (so a CDN gives
/// us the same anycast POP the browser gets), then the public fallbacks. Deduped, order-stable.
fn effective_upstreams() -> Vec<SocketAddr> {
    let mut out: Vec<SocketAddr> = Vec::new();
    let mut seen = HashSet::new();
    for addr in system_dns_servers() {
        if seen.insert(addr) {
            out.push(addr);
        }
    }
    for s in FALLBACK_UPSTREAMS {
        if let Ok(addr) = s.parse::<SocketAddr>() {
            if seen.insert(addr) {
                out.push(addr);
            }
        }
    }
    out
}

/// Normalize each host (strip `*.`/trailing dot, lowercase) and pair it with its `www.` variant,
/// deduped and order-stable. Mirrors focusd's `resolver.GetDomainVariants`.
fn expand_www_variants(hosts: &[String]) -> Vec<String> {
    let mut names = Vec::new();
    let mut seen = HashSet::new();
    for host in hosts {
        let name = host
            .trim()
            .trim_start_matches("*.")
            .trim_end_matches('.')
            .to_ascii_lowercase();
        if name.is_empty() {
            continue;
        }
        if seen.insert(name.clone()) {
            names.push(name.clone());
        }
        if !name.starts_with("www.") {
            let www = format!("www.{name}");
            if seen.insert(www.clone()) {
                names.push(www);
            }
        }
    }
    names
}

/// Bind the resolver socket to the fixed source port (any address). Returns None if the port is
/// already in use (e.g. a second instance) — the caller then no-ops.
fn bind_socket() -> Option<UdpSocket> {
    UdpSocket::bind((Ipv4Addr::UNSPECIFIED, RESOLVER_SRC_PORT)).ok()
}

/// Enumerate the OS-configured DNS servers (per active adapter) as `SocketAddr` on :53. Best
/// effort — returns empty on any API failure, in which case the public fallbacks cover us. We query
/// through these (not hardcoded public resolvers) so a CDN hands us the same anycast POP IPs the
/// browser gets, since the browser also resolves via the OS servers.
fn system_dns_servers() -> Vec<SocketAddr> {
    use windows::Win32::Foundation::ERROR_BUFFER_OVERFLOW;
    use windows::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_FRIENDLY_NAME,
        GAA_FLAG_SKIP_MULTICAST, IP_ADAPTER_ADDRESSES_LH,
    };
    use windows::Win32::Networking::WinSock::{
        AF_INET, AF_INET6, AF_UNSPEC, SOCKADDR_IN, SOCKADDR_IN6,
    };

    let flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_FRIENDLY_NAME;
    let mut size: u32 = 15 * 1024;
    let mut buf: Vec<u8> = Vec::new();
    let mut filled = false;
    for _ in 0..3 {
        buf = vec![0u8; size as usize];
        let ret = unsafe {
            GetAdaptersAddresses(
                AF_UNSPEC.0 as u32,
                flags,
                None,
                Some(buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH),
                &mut size,
            )
        };
        if ret == 0 {
            filled = true;
            break;
        }
        if ret == ERROR_BUFFER_OVERFLOW.0 {
            continue; // `size` now holds the needed length; retry with a bigger buffer
        }
        return Vec::new();
    }
    if !filled {
        return Vec::new();
    }

    let mut out = Vec::new();
    let mut cur = buf.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
    unsafe {
        while !cur.is_null() {
            let ad = &*cur;
            // OperStatus == IfOperStatusUp (1): skip down/disconnected adapters (they carry the
            // bogus fec0:: placeholder servers).
            if ad.OperStatus.0 == 1 {
                let mut dns = ad.FirstDnsServerAddress;
                while !dns.is_null() {
                    let d = &*dns;
                    let sa = d.Address.lpSockaddr;
                    if !sa.is_null() {
                        let fam = (*sa).sa_family;
                        let ip = if fam == AF_INET {
                            let s = &*(sa as *const SOCKADDR_IN);
                            let b = s.sin_addr.S_un.S_un_b;
                            Some(IpAddr::from(Ipv4Addr::new(b.s_b1, b.s_b2, b.s_b3, b.s_b4)))
                        } else if fam == AF_INET6 {
                            let s = &*(sa as *const SOCKADDR_IN6);
                            Some(IpAddr::from(Ipv6Addr::from(s.sin6_addr.u.Byte)))
                        } else {
                            None
                        };
                        if let Some(ip) = ip {
                            if is_real_resolver(ip) {
                                out.push(SocketAddr::new(ip, 53));
                            }
                        }
                    }
                    dns = d.Next;
                }
            }
            cur = ad.Next;
        }
    }
    out
}

/// Reject non-routable / placeholder DNS addresses Windows lists on adapters with no real DNS:
/// loopback, unspecified, IPv4 link-local (169.254/16), and the IPv6 link-local fe80::/10 +
/// site-local fec0::/10 well-known placeholders.
fn is_real_resolver(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(a) => !a.is_loopback() && !a.is_unspecified() && !a.is_link_local(),
        IpAddr::V6(a) => {
            if a.is_loopback() || a.is_unspecified() {
                return false;
            }
            let o = a.octets();
            !(o[0] == 0xfe && (o[1] & 0xc0) != 0) // fe80::/10 + fec0::/10
        }
    }
}

/// Send one query for `name`/`qtype`, trying each upstream until one answers; parse the IPs out.
fn query_one(
    sock: &UdpSocket,
    name: &str,
    qtype: u16,
    txid: u16,
    upstreams: &[SocketAddr],
) -> Vec<IpAddr> {
    let query = build_query(txid, name, qtype);
    let mut buf = [0u8; 1500];
    for addr in upstreams {
        let addr = *addr;
        if sock.send_to(&query, addr).is_err() {
            continue;
        }
        // Drain until we get the datagram matching our txid (or time out → next upstream).
        for _ in 0..4 {
            match sock.recv_from(&mut buf) {
                Ok((n, _)) if n >= 2 && u16::from_be_bytes([buf[0], buf[1]]) == txid => {
                    return parse_answers(&buf[..n], qtype);
                }
                Ok(_) => continue, // stray/mismatched datagram; keep draining
                Err(_) => break,   // timeout → try the next upstream
            }
        }
    }
    Vec::new()
}

/// Build a standard recursive DNS query: header (RD=1, one question) + the encoded question.
fn build_query(txid: u16, name: &str, qtype: u16) -> Vec<u8> {
    let mut q = Vec::with_capacity(32 + name.len());
    q.extend_from_slice(&txid.to_be_bytes());
    q.extend_from_slice(&[0x01, 0x00]); // flags: RD=1
    q.extend_from_slice(&[0x00, 0x01]); // QDCOUNT=1
    q.extend_from_slice(&[0x00, 0x00]); // ANCOUNT
    q.extend_from_slice(&[0x00, 0x00]); // NSCOUNT
    q.extend_from_slice(&[0x00, 0x00]); // ARCOUNT
    for label in name.split('.') {
        if label.is_empty() {
            continue;
        }
        let bytes = label.as_bytes();
        q.push(bytes.len().min(63) as u8);
        q.extend_from_slice(&bytes[..bytes.len().min(63)]);
    }
    q.push(0); // root label
    q.extend_from_slice(&qtype.to_be_bytes());
    q.extend_from_slice(&[0x00, 0x01]); // QCLASS=IN
    q
}

/// Parse A (qtype 1) or AAAA (qtype 28) addresses from a DNS response, honoring name
/// compression. Bounds-checked throughout; returns whatever it could parse (empty on
/// NXDOMAIN / malformed / mismatched type).
fn parse_answers(buf: &[u8], want_type: u16) -> Vec<IpAddr> {
    let mut out = Vec::new();
    if buf.len() < 12 {
        return out;
    }
    // RCODE != 0 (e.g. NXDOMAIN) → no usable answers.
    if buf[3] & 0x0f != 0 {
        return out;
    }
    let qd = u16::from_be_bytes([buf[4], buf[5]]) as usize;
    let an = u16::from_be_bytes([buf[6], buf[7]]) as usize;
    let mut pos = 12;
    // Skip the question section.
    for _ in 0..qd {
        pos = match skip_name(buf, pos) {
            Some(p) => p + 4, // + QTYPE(2) + QCLASS(2)
            None => return out,
        };
    }
    for _ in 0..an {
        pos = match skip_name(buf, pos) {
            Some(p) => p,
            None => return out,
        };
        // TYPE(2) CLASS(2) TTL(4) RDLENGTH(2)
        let Some(hdr) = buf.get(pos..pos + 10) else {
            return out;
        };
        let rtype = u16::from_be_bytes([hdr[0], hdr[1]]);
        let rdlen = u16::from_be_bytes([hdr[8], hdr[9]]) as usize;
        pos += 10;
        let Some(rdata) = buf.get(pos..pos + rdlen) else {
            return out;
        };
        if rtype == want_type {
            match (want_type, rdlen) {
                (QTYPE_A, 4) => {
                    out.push(Ipv4Addr::new(rdata[0], rdata[1], rdata[2], rdata[3]).into());
                }
                (QTYPE_AAAA, 16) => {
                    let mut o = [0u8; 16];
                    o.copy_from_slice(rdata);
                    out.push(Ipv6Addr::from(o).into());
                }
                _ => {}
            }
        }
        pos += rdlen;
    }
    out
}

/// Advance past a DNS name at `pos`, returning the offset just after it. Handles a compression
/// pointer (two bytes, top two bits set) and a label sequence ending in a zero length octet.
fn skip_name(buf: &[u8], mut pos: usize) -> Option<usize> {
    loop {
        let len = *buf.get(pos)?;
        if len & 0xC0 == 0xC0 {
            return Some(pos + 2); // pointer is two bytes; the name ends here
        }
        if len == 0 {
            return Some(pos + 1);
        }
        pos += 1 + len as usize;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_www_variants_deduped_and_stable() {
        let got = expand_www_variants(&[
            "reddit.com".into(),
            "*.redditstatic.com".into(),
            "www.example.com".into(),
            "reddit.com".into(), // duplicate
        ]);
        assert_eq!(
            got,
            vec![
                "reddit.com",
                "www.reddit.com",
                "redditstatic.com",
                "www.redditstatic.com",
                "www.example.com", // already www. -> no www.www. variant
            ]
        );
    }

    #[test]
    fn build_query_shape() {
        let q = build_query(0xabcd, "reddit.com", QTYPE_A);
        assert_eq!(&q[0..2], &[0xab, 0xcd]); // txid
        assert_eq!(&q[2..4], &[0x01, 0x00]); // RD=1
        assert_eq!(&q[4..6], &[0x00, 0x01]); // QDCOUNT=1
                                             // question: 6 r e d d i t 3 c o m 0  TYPE=1 CLASS=1
        assert_eq!(q[12], 6);
        assert_eq!(&q[13..19], b"reddit");
        assert_eq!(*q.last().unwrap(), 0x01); // QCLASS low byte
                                              // Trailing 5 bytes are: root label(1) + QTYPE(2) + QCLASS(2).
        assert_eq!(q[q.len() - 5], 0); // root label terminates the QNAME
        assert_eq!(&q[q.len() - 4..], &[0x00, 0x01, 0x00, 0x01]); // QTYPE=A, QCLASS=IN
    }

    #[test]
    fn parse_a_record_with_compression() {
        // Header: txid, flags(QR,RD,RA, RCODE0), QD=1, AN=1
        let mut r = vec![0x12, 0x34, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0];
        // Question: "a.com" A IN
        r.extend_from_slice(&[1, b'a', 3, b'c', b'o', b'm', 0]);
        r.extend_from_slice(&[0, 1, 0, 1]);
        // Answer: name = compression pointer to offset 12, TYPE A, CLASS IN, TTL, RDLEN 4, RDATA
        r.extend_from_slice(&[0xC0, 0x0C]);
        r.extend_from_slice(&[0, 1, 0, 1, 0, 0, 0, 60, 0, 4]);
        r.extend_from_slice(&[93, 184, 216, 34]);
        let ips = parse_answers(&r, QTYPE_A);
        assert_eq!(ips, vec![IpAddr::from(Ipv4Addr::new(93, 184, 216, 34))]);
    }

    #[test]
    fn nxdomain_yields_nothing() {
        // RCODE = 3 (NXDOMAIN) in the low nibble of byte 3.
        let r = vec![0x12, 0x34, 0x81, 0x83, 0, 1, 0, 0, 0, 0, 0, 0];
        assert!(parse_answers(&r, QTYPE_A).is_empty());
    }

    #[test]
    fn mismatched_type_skipped() {
        // One AAAA answer, but caller wants A → nothing returned, no panic.
        let mut r = vec![0x12, 0x34, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0];
        r.extend_from_slice(&[1, b'a', 0, 0, 28, 0, 1]); // question AAAA
        r.extend_from_slice(&[0xC0, 0x0C, 0, 28, 0, 1, 0, 0, 0, 60, 0, 16]);
        r.extend_from_slice(&[0u8; 16]);
        assert!(parse_answers(&r, QTYPE_A).is_empty());
        assert_eq!(parse_answers(&r, QTYPE_AAAA).len(), 1);
    }
}
