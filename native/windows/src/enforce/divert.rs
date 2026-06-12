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

use std::collections::HashSet;
use std::ffi::{c_void, CString};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::sync::Arc;
use std::time::Duration;

use sysinfo::System;
use windows::Win32::NetworkManagement::IpHelper::{
    GetBestInterfaceEx, GetExtendedTcpTable, MIB_TCP6TABLE_OWNER_PID, MIB_TCPTABLE_OWNER_PID,
    TCP_TABLE_OWNER_PID_CONNECTIONS,
};
use windows::Win32::Networking::WinSock::{
    AF_INET, AF_INET6, SOCKADDR, SOCKADDR_IN, SOCKADDR_IN6,
};

use windivert_sys::address::WINDIVERT_ADDRESS;
use windivert_sys::{
    ChecksumFlags, WinDivertClose, WinDivertFlags, WinDivertHelperCalcChecksums, WinDivertLayer,
    WinDivertOpen, WinDivertRecv, WinDivertSend, WinDivertShutdown, WinDivertShutdownMode,
};
use windivert_win::Win32::Foundation::HANDLE;

use crate::enforce::dns::{nxdomain_reply, read_qname};
use crate::enforce::EnforceShared;
use crate::model::Policy;
use crate::policy_match::{is_app_blocked, is_browser_image, is_doh_bypass_host, is_host_blocked};

const PROTO_TCP: u8 = 6;
const PROTO_UDP: u8 = 17;
const PORT_DNS: u16 = 53;
const PORT_DOT: u16 = 853;
/// MIB_TCP_STATE_ESTAB — only reset connections that are actually established.
const TCP_STATE_ESTAB: i32 = 5;
/// How long the reset burst captures browser TCP traffic looking for flows to RST.
const RESET_BURST: Duration = Duration::from_secs(8);
/// Cap on distinct remote IPs baked into the burst filter (keeps the filter string sane).
const MAX_BURST_IPS: usize = 120;
/// TCP flag bytes (the 13th byte of the TCP header).
const TCP_FLAG_SYN: u8 = 0x02;
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
    fn open(filter: &str, flags: WinDivertFlags) -> std::io::Result<Self> {
        let cfilter = CString::new(filter)
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "filter has NUL"))?;
        let handle =
            unsafe { WinDivertOpen(cfilter.as_ptr(), WinDivertLayer::Network, 0, flags) };
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
/// open for the whole service lifetime; when focus is off we simply reinject everything.
const ENGINE_FILTER: &str =
    "outbound and (udp.DstPort == 53 or tcp.DstPort == 53 or udp.DstPort == 853 or tcp.DstPort == 853)";

pub fn run_engine(shared: Arc<EnforceShared>, shutdown: tokio::sync::watch::Receiver<bool>) {
    let diverter = match Diverter::open(ENGINE_FILTER, WinDivertFlags::new()) {
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
                        let mut out =
                            build_udp_reply(pkt.dst, pkt.src, dport, sport, &reply);
                        if out.is_empty() {
                            return false;
                        }
                        let mut reply_addr = inbound_addr_from(addr);
                        calc_checksums(&mut out, &mut reply_addr);
                        let _ = diverter.send(&out, &reply_addr);
                        return true; // drop original query
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

// ---------------------------------------------------------------------------
// Connection reset
// ---------------------------------------------------------------------------

/// A reset worker thread that waits for signals from `EnforceShared::request_reset` (fired on
/// focus-on and policy changes while active) and tears down browser TCP flows. Reset runs on
/// its own thread so the DNS engine keeps filtering during the burst.
pub fn run_reset_worker(
    shared: Arc<EnforceShared>,
    mut signals: tokio::sync::mpsc::UnboundedReceiver<()>,
) {
    while let Some(()) = signals.blocking_recv() {
        // Coalesce a flurry of signals into one pass.
        while signals.try_recv().is_ok() {}
        if shared.is_active() {
            // Drop stale allowed entries the OS resolver cached (e.g. while focus was off), so
            // every subsequent lookup re-hits the engine instead of reusing a cached IP.
            flush_dns_cache();
            reset_browser_connections(&shared.policy_snapshot());
        }
    }
}

/// Flush the Windows DNS resolver cache. Shelling `ipconfig /flushdns` is the documented way
/// and keeps us off the undocumented dnsapi entry point.
fn flush_dns_cache() {
    crate::run::run_command("ipconfig", &["/flushdns"], "flush DNS cache");
}

fn reset_browser_connections(policy: &Policy) {
    let targets = target_pids(policy);
    if targets.is_empty() {
        return;
    }
    let conns = established_conns(&targets);
    if conns.is_empty() {
        return;
    }

    let killset: HashSet<(IpAddr, u16, IpAddr, u16)> = conns
        .iter()
        .map(|c| (c.local, c.local_port, c.remote, c.remote_port))
        .collect();
    let mut ips: Vec<IpAddr> = conns.iter().map(|c| c.remote).collect();
    ips.sort();
    ips.dedup();
    ips.truncate(MAX_BURST_IPS);

    let filter = build_burst_filter(&ips);
    let burst = match Diverter::open(&filter, WinDivertFlags::new()) {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!("reset burst open failed: {e}");
            return;
        }
    };

    // Bound the burst: a timer thread shuts down recv after RESET_BURST so idle flows don't
    // block us forever. WinDivertShutdown(Recv) makes the recv loop drain and then exit.
    let raw = burst.raw();
    std::thread::spawn(move || {
        std::thread::sleep(RESET_BURST);
        unsafe {
            let _ = WinDivertShutdown(HANDLE(raw), WinDivertShutdownMode::Recv);
        }
    });

    // Idle sockets emit no packets, so passive RST never fires on them. Poke each target with
    // an inbound SYN: per RFC 5961 the local stack answers an established connection's stray SYN
    // with a "challenge ACK" — an outbound packet the recv loop below catches and turns into a
    // properly-sequenced RST. This is what lets us reap idle browser connections (v4 and v6).
    for conn in &conns {
        if let Some(ifindex) = best_iface(conn.remote) {
            let probe = build_tcp(
                conn.remote,
                conn.local,
                conn.remote_port,
                conn.local_port,
                0,
                0,
                TCP_FLAG_SYN,
            );
            if !probe.is_empty() {
                let mut probe = probe;
                let mut paddr = injected_inbound_addr(ifindex, conn.remote.is_ipv6());
                calc_checksums(&mut probe, &mut paddr);
                let _ = burst.send(&probe, &paddr);
            }
        }
    }

    let mut buf = vec![0u8; 65535];
    let mut killed = 0usize;
    loop {
        let (n, addr) = match burst.recv(&mut buf) {
            Ok(x) => x,
            Err(_) => break, // shutdown or drained
        };
        let data = &buf[..n];
        let Some(pkt) = parse_ip(data) else {
            let _ = burst.send(data, &addr);
            continue;
        };
        if pkt.proto != PROTO_TCP {
            let _ = burst.send(data, &addr);
            continue;
        }
        let Some(tcp) = tcp_fields(data, pkt.l4_off) else {
            let _ = burst.send(data, &addr);
            continue;
        };
        // Captured packet is outbound local->remote; match against the snapshot.
        let key = (pkt.src, tcp.sport, pkt.dst, tcp.dport);
        if killset.contains(&key) {
            // Inject an inbound RST remote->local with seq = the ack we just observed (the
            // remote's next expected sequence), which the local stack accepts → socket dies.
            let mut rst = build_rst(pkt.dst, pkt.src, tcp.dport, tcp.sport, tcp.ack);
            if !rst.is_empty() {
                let mut rst_addr = inbound_addr_from(&addr);
                calc_checksums(&mut rst, &mut rst_addr);
                let _ = burst.send(&rst, &rst_addr);
                killed += 1;
            }
            // Drop the original outbound packet (don't reinject).
        } else {
            let _ = burst.send(data, &addr);
        }
    }
    tracing::info!("connection-reset burst complete ({killed} RST injected)");
}

/// PIDs of processes whose live TCP flows we should reset: browsers + anything on the
/// blocked-app list.
fn target_pids(policy: &Policy) -> HashSet<u32> {
    let mut sys = System::new();
    sys.refresh_processes();
    let mut pids = HashSet::new();
    for process in sys.processes().values() {
        let name = process.name();
        if is_browser_image(name) || is_app_blocked(policy, name) {
            pids.insert(process.pid().as_u32());
        }
    }
    pids
}

struct Conn {
    local: IpAddr,
    local_port: u16,
    remote: IpAddr,
    remote_port: u16,
}

/// Enumerate established TCP connections (IPv4 + IPv6) owned by `targets`.
fn established_conns(targets: &HashSet<u32>) -> Vec<Conn> {
    let mut out = Vec::new();
    collect_tcp4(targets, &mut out);
    collect_tcp6(targets, &mut out);
    out
}

fn collect_tcp4(targets: &HashSet<u32>, out: &mut Vec<Conn>) {
    unsafe {
        let mut size = 0u32;
        let _ = GetExtendedTcpTable(
            None,
            &mut size,
            false,
            AF_INET.0 as u32,
            TCP_TABLE_OWNER_PID_CONNECTIONS,
            0,
        );
        if size == 0 {
            return;
        }
        let mut buf = vec![0u8; size as usize];
        let rc = GetExtendedTcpTable(
            Some(buf.as_mut_ptr() as *mut c_void),
            &mut size,
            false,
            AF_INET.0 as u32,
            TCP_TABLE_OWNER_PID_CONNECTIONS,
            0,
        );
        if rc != 0 {
            return;
        }
        let table = &*(buf.as_ptr() as *const MIB_TCPTABLE_OWNER_PID);
        let rows = std::slice::from_raw_parts(table.table.as_ptr(), table.dwNumEntries as usize);
        for row in rows {
            if row.dwState != TCP_STATE_ESTAB as u32 || !targets.contains(&row.dwOwningPid) {
                continue;
            }
            out.push(Conn {
                local: Ipv4Addr::from(row.dwLocalAddr.to_ne_bytes()).into(),
                local_port: net_port(row.dwLocalPort),
                remote: Ipv4Addr::from(row.dwRemoteAddr.to_ne_bytes()).into(),
                remote_port: net_port(row.dwRemotePort),
            });
        }
    }
}

fn collect_tcp6(targets: &HashSet<u32>, out: &mut Vec<Conn>) {
    unsafe {
        let mut size = 0u32;
        let _ = GetExtendedTcpTable(
            None,
            &mut size,
            false,
            AF_INET6.0 as u32,
            TCP_TABLE_OWNER_PID_CONNECTIONS,
            0,
        );
        if size == 0 {
            return;
        }
        let mut buf = vec![0u8; size as usize];
        let rc = GetExtendedTcpTable(
            Some(buf.as_mut_ptr() as *mut c_void),
            &mut size,
            false,
            AF_INET6.0 as u32,
            TCP_TABLE_OWNER_PID_CONNECTIONS,
            0,
        );
        if rc != 0 {
            return;
        }
        let table = &*(buf.as_ptr() as *const MIB_TCP6TABLE_OWNER_PID);
        let rows = std::slice::from_raw_parts(table.table.as_ptr(), table.dwNumEntries as usize);
        for row in rows {
            if row.dwState != TCP_STATE_ESTAB as u32 || !targets.contains(&row.dwOwningPid) {
                continue;
            }
            out.push(Conn {
                local: Ipv6Addr::from(row.ucLocalAddr).into(),
                local_port: net_port(row.dwLocalPort),
                remote: Ipv6Addr::from(row.ucRemoteAddr).into(),
                remote_port: net_port(row.dwRemotePort),
            });
        }
    }
}

/// MIB port fields hold the port in network byte order in the low word of a DWORD.
fn net_port(dw: u32) -> u16 {
    let b = dw.to_ne_bytes();
    u16::from_be_bytes([b[0], b[1]])
}

fn build_burst_filter(ips: &[IpAddr]) -> String {
    let mut parts = Vec::with_capacity(ips.len());
    for ip in ips {
        match ip {
            IpAddr::V4(a) => parts.push(format!("ip.DstAddr == {a}")),
            IpAddr::V6(a) => parts.push(format!("ipv6.DstAddr == {a}")),
        }
    }
    format!("outbound and tcp and ({})", parts.join(" or "))
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

/// Convenience for the RST case (no ACK flag/number needed; seq must be in-window).
fn build_rst(src: IpAddr, dst: IpAddr, src_port: u16, dst_port: u16, seq: u32) -> Vec<u8> {
    build_tcp(src, dst, src_port, dst_port, seq, 0, TCP_FLAG_RST)
}

/// Best outbound interface index to reach `remote` — needed as the injection interface for the
/// inbound probe packets (a captured packet would carry it, but probes are manufactured).
fn best_iface(remote: IpAddr) -> Option<u32> {
    let mut idx = 0u32;
    let rc = unsafe {
        match remote {
            IpAddr::V4(a) => {
                let mut sa: SOCKADDR_IN = std::mem::zeroed();
                sa.sin_family = AF_INET;
                sa.sin_addr.S_un.S_addr = u32::from_ne_bytes(a.octets());
                GetBestInterfaceEx(&sa as *const _ as *const SOCKADDR, &mut idx)
            }
            IpAddr::V6(a) => {
                let mut sa: SOCKADDR_IN6 = std::mem::zeroed();
                sa.sin6_family = AF_INET6;
                sa.sin6_addr.u.Byte = a.octets();
                GetBestInterfaceEx(&sa as *const _ as *const SOCKADDR, &mut idx)
            }
        }
    };
    if rc == 0 {
        Some(idx)
    } else {
        None
    }
}

/// A zeroed network-layer address set up to inject an inbound packet on a given interface.
fn injected_inbound_addr(ifindex: u32, v6: bool) -> WINDIVERT_ADDRESS {
    let mut addr = WINDIVERT_ADDRESS::default(); // layer=Network, event=NetworkPacket (both 0)
    addr.set_outbound(false);
    addr.set_ipv6(v6);
    unsafe {
        addr.union_field.Network.interface_id = ifindex;
    }
    addr
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
        assert_eq!(u32::from_be_bytes([tcp[4], tcp[5], tcp[6], tcp[7]]), 0x11223344);
        assert_eq!(tcp[13], 0x04); // RST flag
    }

    #[test]
    fn net_port_decodes_network_order() {
        // 53 in network order stored in the low word of a DWORD = 0x3500 little-endian.
        assert_eq!(net_port(0x3500), 53);
    }

    #[test]
    fn burst_filter_mixes_families() {
        let ips = [
            Ipv4Addr::new(1, 2, 3, 4).into(),
            Ipv6Addr::LOCALHOST.into(),
        ];
        let f = build_burst_filter(&ips);
        assert!(f.contains("ip.DstAddr == 1.2.3.4"));
        assert!(f.contains("ipv6.DstAddr == ::1"));
        assert!(f.starts_with("outbound and tcp and ("));
    }
}
