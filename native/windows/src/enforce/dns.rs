//! Local DNS sinkhole + adapter-DNS redirection (architecture §4.1).
//!
//! The sinkhole binds 127.0.0.1:53. For a blocked name it answers NXDOMAIN; for an allowed
//! name it forwards the original query to UPSTREAM_DNS and relays the reply. We point every
//! adapter's DNS at 127.0.0.1 (via PowerShell) so the OS resolver path flows through us.
//!
//! Known v1 gap (accepted in the plan): an app that hard-codes an external resolver IP, or
//! uses DNS-over-HTTPS, can bypass the sinkhole. Closing that needs the WFP connect-redirect
//! callout (kernel) or a DoH IP blocklist — both deferred. We periodically re-assert adapter
//! DNS (core.rs) so casual "just change my DNS server" edits get reverted.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use tokio::net::UdpSocket;

use crate::constants::{SINKHOLE_ADDR, UPSTREAM_DNS};
use crate::enforce::EnforceShared;
use crate::policy_match::is_host_blocked;
use crate::run::run_command;

/// Parse the QNAME from a DNS query. Returns (name, offset_just_past_question).
fn read_qname(buf: &[u8]) -> Option<(String, usize)> {
    if buf.len() < 12 {
        return None;
    }
    let mut pos = 12; // skip the 12-byte header
    let mut labels = Vec::new();
    loop {
        let len = *buf.get(pos)? as usize;
        pos += 1;
        if len == 0 {
            break;
        }
        if len & 0xC0 != 0 {
            return None; // compression pointers don't appear in questions
        }
        let end = pos + len;
        let label = buf.get(pos..end)?;
        labels.push(String::from_utf8_lossy(label).to_string());
        pos = end;
    }
    // QTYPE (2) + QCLASS (2) follow the QNAME.
    let after = pos + 4;
    if after > buf.len() {
        return None;
    }
    Some((labels.join("."), after))
}

/// Build an NXDOMAIN reply from a query: keep the question, flip QR + RA, set RCODE=3, zero
/// the answer/authority/additional counts.
fn nxdomain_reply(query: &[u8], question_end: usize) -> Vec<u8> {
    let mut reply = query[..question_end].to_vec();
    reply[2] = 0x81; // QR=1, RD=1
    reply[3] = 0x83; // RA=1, RCODE=3 (NXDOMAIN)
    for i in 6..12 {
        reply[i] = 0; // ANCOUNT/NSCOUNT/ARCOUNT = 0
    }
    reply
}

/// Forward a query to the upstream resolver and return the reply bytes (async; non-blocking).
async fn forward_upstream(query: &[u8]) -> Option<Vec<u8>> {
    let upstream: SocketAddr = UPSTREAM_DNS.parse().ok()?;
    let sock = UdpSocket::bind("0.0.0.0:0").await.ok()?;
    sock.send_to(query, upstream).await.ok()?;
    let mut buf = vec![0u8; 1500];
    let recv = tokio::time::timeout(Duration::from_secs(3), sock.recv_from(&mut buf)).await;
    let (n, _) = recv.ok()?.ok()?;
    buf.truncate(n);
    Some(buf)
}

/// Run the sinkhole until `shutdown` fires. Always running; self-gates on focus state. Each
/// query is handled in its own task so a slow upstream lookup never blocks other queries.
pub async fn run_sinkhole(shared: Arc<EnforceShared>, mut shutdown: tokio::sync::watch::Receiver<bool>) {
    let socket = match UdpSocket::bind(SINKHOLE_ADDR).await {
        Ok(s) => Arc::new(s),
        Err(e) => {
            tracing::error!("sinkhole bind {SINKHOLE_ADDR} failed: {e} (port 53 in use or no privilege?)");
            return;
        }
    };
    tracing::info!("DNS sinkhole listening on {SINKHOLE_ADDR}");
    let mut buf = vec![0u8; 1500];

    loop {
        tokio::select! {
            _ = shutdown.changed() => {
                if *shutdown.borrow() { break; }
            }
            res = socket.recv_from(&mut buf) => {
                let Ok((n, src)) = res else { continue };
                let query = buf[..n].to_vec();
                let shared = shared.clone();
                let socket = socket.clone();
                tokio::spawn(async move {
                    if let Some(reply) = handle_query(&shared, &query).await {
                        let _ = socket.send_to(&reply, src).await;
                    }
                });
            }
        }
    }
    tracing::info!("DNS sinkhole stopped");
}

async fn handle_query(shared: &EnforceShared, query: &[u8]) -> Option<Vec<u8>> {
    if shared.is_active() {
        if let Some((name, qend)) = read_qname(query) {
            if is_host_blocked(&shared.policy_snapshot(), &name) {
                tracing::debug!("blocked {name}");
                return Some(nxdomain_reply(query, qend));
            }
        }
    }
    // Allowed (or unparseable, or focus off): forward upstream so DNS keeps working.
    forward_upstream(query).await
}

/// Point every up physical adapter's DNS at the loopback sinkhole.
pub fn point_adapters_to_sinkhole() {
    let script = "Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' } | \
        Set-DnsClientServerAddress -ServerAddresses '127.0.0.1'";
    run_command("powershell", &["-NoProfile", "-NonInteractive", "-Command", script], "point adapter DNS to sinkhole");
}

/// Reset adapters' DNS back to automatic (DHCP).
pub fn restore_adapter_dns() {
    let script = "Get-NetAdapter -Physical | \
        Set-DnsClientServerAddress -ResetServerAddresses";
    run_command("powershell", &["-NoProfile", "-NonInteractive", "-Command", script], "restore adapter DNS");
}
