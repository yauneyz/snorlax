//! Active blocked-domain resolver (architecture §4.1, IP-first blocking).
//!
//! Ports the idea from the Linux sibling `focusd` (`internal/resolver/resolver.go`): resolve the
//! domains we care about to their A/AAAA IPs ourselves, up front, so focus-on can pre-arm the
//! suspect-IP drop set without waiting to *observe* a blocked host on the wire. This is the
//! "active" half of the suspect set; the persisted `observations` store is the "passive" half.
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

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, UdpSocket};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::enforce::EnforceShared;

/// Fixed local UDP source port our resolver binds to. `enforce::divert::ENGINE_FILTER` excludes
/// this port so the sinkhole never captures our own queries while focus is active.
pub const RESOLVER_SRC_PORT: u16 = 5354;

/// Pinned upstream resolvers (UDP/53). Independent of the OS resolver and of the machine's
/// configured DNS, mirroring `focusd`'s upstream set. Tried in order with failover.
const UPSTREAMS: &[&str] = &["1.1.1.1:53", "8.8.8.8:53", "1.0.0.1:53", "9.9.9.9:53"];

const QTYPE_A: u16 = 1;
const QTYPE_AAAA: u16 = 28;
const QUERY_TIMEOUT: Duration = Duration::from_millis(1500);

/// How often the background resolver re-resolves the policy's domains. CDN IPs rotate, so this
/// refreshes the suspect/clean sets (and grows the antibody store) on a cadence — focusd uses the
/// same interval-based approach.
const RESOLVE_INTERVAL: Duration = Duration::from_secs(300);

/// Resolve the policy's relevant domains and feed every `host → ip` into `shared`: the antibody
/// store always grows, and while focused the live suspect/clean set is armed per mode. Blocking;
/// call from a dedicated thread (or a one-shot focus-on kick).
pub fn resolve_and_ingest(shared: &EnforceShared) {
    let targets = shared.resolver_targets();
    if targets.is_empty() {
        return;
    }
    let pairs = resolve_hosts(&targets);
    if pairs.is_empty() {
        return;
    }
    tracing::info!(
        "resolver: {} host→ip pairs for {} domains",
        pairs.len(),
        targets.len()
    );
    for (host, ip) in pairs {
        shared.ingest_resolved(&host, ip);
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
/// caller's set). Best-effort: a bind failure or all-upstreams-timeout yields an empty result
/// (the passive observation store still covers us). Blocking; call from a dedicated thread.
pub fn resolve_hosts(hosts: &[String]) -> Vec<(String, IpAddr)> {
    if hosts.is_empty() {
        return Vec::new();
    }
    let sock = match bind_socket() {
        Some(s) => s,
        None => return Vec::new(),
    };
    let _ = sock.set_read_timeout(Some(QUERY_TIMEOUT));
    let mut txid: u16 = rand::random();
    let mut out = Vec::new();
    for host in hosts {
        let name = host.trim().trim_start_matches("*.").trim_end_matches('.');
        if name.is_empty() {
            continue;
        }
        for qtype in [QTYPE_A, QTYPE_AAAA] {
            txid = txid.wrapping_add(1);
            for ip in query_one(&sock, name, qtype, txid) {
                out.push((name.to_ascii_lowercase(), ip));
            }
        }
    }
    out
}

/// Bind the resolver socket to the fixed source port (any address). Returns None if the port is
/// already in use (e.g. a second instance) — the caller then no-ops.
fn bind_socket() -> Option<UdpSocket> {
    UdpSocket::bind((Ipv4Addr::UNSPECIFIED, RESOLVER_SRC_PORT)).ok()
}

/// Send one query for `name`/`qtype`, trying each upstream until one answers; parse the IPs out.
fn query_one(sock: &UdpSocket, name: &str, qtype: u16, txid: u16) -> Vec<IpAddr> {
    let query = build_query(txid, name, qtype);
    let mut buf = [0u8; 1500];
    for up in UPSTREAMS {
        let Ok(addr) = up.parse::<SocketAddr>() else {
            continue;
        };
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
