//! Warm policy-domain resolver feeding the pf IP tables. macOS keeps /etc/resolv.conf populated
//! via configd, so reading it for upstreams works here just as on Linux.

use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, UdpSocket};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::enforce::{EnforceShared, ResolvedClass};
use crate::model::Mode;

pub const RESOLVER_SRC_PORT: u16 = 5354;

const FALLBACK_UPSTREAMS: &[&str] = &["1.1.1.1:53", "8.8.8.8:53", "1.0.0.1:53", "9.9.9.9:53"];
const QTYPE_A: u16 = 1;
const QTYPE_AAAA: u16 = 28;
const QUERY_TIMEOUT: Duration = Duration::from_millis(1500);
const RESOLVE_INTERVAL: Duration = Duration::from_secs(300);

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
        "resolver: {} host->ip pairs for {} domains",
        pairs.len(),
        targets.len()
    );
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

fn bind_socket() -> Option<UdpSocket> {
    UdpSocket::bind((Ipv4Addr::UNSPECIFIED, RESOLVER_SRC_PORT))
        .or_else(|_| UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)))
        .ok()
}

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

fn system_dns_servers() -> Vec<SocketAddr> {
    let Ok(contents) = std::fs::read_to_string("/etc/resolv.conf") else {
        return Vec::new();
    };
    contents
        .lines()
        .filter_map(|line| {
            let line = line.split('#').next()?.trim();
            let mut parts = line.split_whitespace();
            if parts.next()? != "nameserver" {
                return None;
            }
            let ip = parts.next()?.parse::<IpAddr>().ok()?;
            if !is_real_resolver(ip) {
                return None;
            }
            Some(SocketAddr::new(ip, 53))
        })
        .collect()
}

fn is_real_resolver(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(a) => !a.is_loopback() && !a.is_unspecified() && !a.is_link_local(),
        IpAddr::V6(a) => !(a.is_loopback() || a.is_unspecified()),
    }
}

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
        if sock.send_to(&query, *addr).is_err() {
            continue;
        }
        for _ in 0..4 {
            match sock.recv_from(&mut buf) {
                Ok((n, _)) if n >= 2 && u16::from_be_bytes([buf[0], buf[1]]) == txid => {
                    return parse_answers(&buf[..n], qtype);
                }
                Ok(_) => continue,
                Err(_) => break,
            }
        }
    }
    Vec::new()
}

fn build_query(txid: u16, name: &str, qtype: u16) -> Vec<u8> {
    let mut q = Vec::with_capacity(32 + name.len());
    q.extend_from_slice(&txid.to_be_bytes());
    q.extend_from_slice(&[0x01, 0x00]);
    q.extend_from_slice(&[0x00, 0x01]);
    q.extend_from_slice(&[0x00, 0x00]);
    q.extend_from_slice(&[0x00, 0x00]);
    q.extend_from_slice(&[0x00, 0x00]);
    for label in name.split('.') {
        if label.is_empty() {
            continue;
        }
        let bytes = label.as_bytes();
        q.push(bytes.len().min(63) as u8);
        q.extend_from_slice(&bytes[..bytes.len().min(63)]);
    }
    q.push(0);
    q.extend_from_slice(&qtype.to_be_bytes());
    q.extend_from_slice(&[0x00, 0x01]);
    q
}

fn parse_answers(buf: &[u8], want_type: u16) -> Vec<IpAddr> {
    let mut out = Vec::new();
    if buf.len() < 12 || (buf[3] & 0x0f) != 0 {
        return out;
    }
    let qd = u16::from_be_bytes([buf[4], buf[5]]) as usize;
    let an = u16::from_be_bytes([buf[6], buf[7]]) as usize;
    let mut pos = 12;
    for _ in 0..qd {
        pos = match skip_name(buf, pos) {
            Some(p) => p + 4,
            None => return out,
        };
    }
    for _ in 0..an {
        pos = match skip_name(buf, pos) {
            Some(p) => p,
            None => return out,
        };
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

fn skip_name(buf: &[u8], mut pos: usize) -> Option<usize> {
    loop {
        let len = *buf.get(pos)?;
        if len & 0xC0 == 0xC0 {
            return Some(pos + 2);
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
            "reddit.com".into(),
        ]);
        assert_eq!(
            got,
            vec![
                "reddit.com",
                "www.reddit.com",
                "redditstatic.com",
                "www.redditstatic.com",
                "www.example.com",
            ]
        );
    }

    #[test]
    fn parse_a_record_with_compression() {
        let mut r = vec![0x12, 0x34, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0];
        r.extend_from_slice(&[1, b'a', 3, b'c', b'o', b'm', 0]);
        r.extend_from_slice(&[0, 1, 0, 1]);
        r.extend_from_slice(&[0xC0, 0x0C]);
        r.extend_from_slice(&[0, 1, 0, 1, 0, 0, 0, 60, 0, 4]);
        r.extend_from_slice(&[93, 184, 216, 34]);
        let ips = parse_answers(&r, QTYPE_A);
        assert_eq!(ips, vec![IpAddr::from(Ipv4Addr::new(93, 184, 216, 34))]);
    }
}
