//! nftables output-hook enforcement.

use std::io::Write;
use std::net::IpAddr;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Duration;

use crate::enforce::EnforceShared;
use crate::model::Mode;

const TABLE_NAME: &str = "focuslock";
const POLL: Duration = Duration::from_millis(250);

pub fn run_manager(shared: Arc<EnforceShared>, shutdown: tokio::sync::watch::Receiver<bool>) {
    let mut installed_gen: Option<u64> = None;
    let mut cleared_inactive = false;
    while !*shutdown.borrow() {
        if !shared.is_active() {
            if installed_gen.take().is_some() || !cleared_inactive {
                remove_rules();
                tracing::info!("nftables rules removed (focus off)");
                cleared_inactive = true;
            }
            std::thread::sleep(POLL);
            continue;
        }
        cleared_inactive = false;

        let gen = shared.generation();
        if installed_gen != Some(gen) {
            let mode = shared.mode();
            let blocked = if mode == Mode::Blacklist {
                shared.blocked_ips()
            } else {
                Vec::new()
            };
            let allowed = if mode == Mode::Whitelist {
                shared.allowed_ips()
            } else {
                Vec::new()
            };
            let script = ruleset(mode.clone(), &blocked, &allowed);
            remove_rules();
            if apply_script(&script) {
                installed_gen = Some(gen);
                tracing::info!("nftables rules applied for {:?}", mode);
            }
        }
        std::thread::sleep(POLL);
    }
}

pub fn remove_rules() {
    let _ = Command::new("nft")
        .args(["delete", "table", "inet", TABLE_NAME])
        .output();
}

fn apply_script(script: &str) -> bool {
    let mut child = match Command::new("nft")
        .args(["-f", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            tracing::warn!("failed to spawn nft: {e}");
            return false;
        }
    };
    if let Some(mut stdin) = child.stdin.take() {
        if let Err(e) = stdin.write_all(script.as_bytes()) {
            tracing::warn!("failed to write nft script: {e}");
            return false;
        }
    }
    match child.wait_with_output() {
        Ok(out) if out.status.success() => true,
        Ok(out) => {
            tracing::warn!(
                "nft failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            );
            false
        }
        Err(e) => {
            tracing::warn!("failed waiting for nft: {e}");
            false
        }
    }
}

fn ruleset(mode: Mode, blocked: &[IpAddr], allowed: &[IpAddr]) -> String {
    let (blocked_v4, blocked_v6) = split_ips(blocked);
    let (allowed_v4, allowed_v6) = split_ips(allowed);
    let mut s = String::new();
    s.push_str(&format!("table inet {TABLE_NAME} {{\n"));
    set(&mut s, "blocked_ips_v4", "ipv4_addr", &blocked_v4);
    set(&mut s, "blocked_ips_v6", "ipv6_addr", &blocked_v6);
    set(&mut s, "allowed_ips_v4", "ipv4_addr", &allowed_v4);
    set(&mut s, "allowed_ips_v6", "ipv6_addr", &allowed_v6);
    s.push_str("  chain output {\n");
    s.push_str("    type filter hook output priority filter; policy accept;\n");
    s.push_str("    tcp dport 853 drop\n");
    s.push_str("    udp dport 853 drop\n");
    match mode {
        Mode::Blacklist => {
            s.push_str("    ip daddr @blocked_ips_v4 drop\n");
            s.push_str("    ip6 daddr @blocked_ips_v6 drop\n");
        }
        Mode::Whitelist => {
            if allowed_v4.is_empty() {
                s.push_str("    ip protocol tcp tcp dport { 80, 443 } drop\n");
                s.push_str("    ip protocol udp udp dport 443 drop\n");
            } else {
                s.push_str("    ip daddr != @allowed_ips_v4 tcp dport { 80, 443 } drop\n");
                s.push_str("    ip daddr != @allowed_ips_v4 udp dport 443 drop\n");
            }
            if allowed_v6.is_empty() {
                s.push_str("    ip6 nexthdr tcp tcp dport { 80, 443 } drop\n");
                s.push_str("    ip6 nexthdr udp udp dport 443 drop\n");
            } else {
                s.push_str("    ip6 daddr != @allowed_ips_v6 tcp dport { 80, 443 } drop\n");
                s.push_str("    ip6 daddr != @allowed_ips_v6 udp dport 443 drop\n");
            }
        }
        Mode::BlockAll => {
            s.push_str("    tcp dport { 80, 443 } drop\n");
            s.push_str("    udp dport 443 drop\n");
        }
    }
    s.push_str("  }\n");
    s.push_str("}\n");
    s
}

fn set(out: &mut String, name: &str, ty: &str, ips: &[String]) {
    out.push_str(&format!("  set {name} {{\n"));
    out.push_str(&format!("    type {ty}\n"));
    if !ips.is_empty() {
        out.push_str(&format!("    elements = {{ {} }}\n", ips.join(", ")));
    }
    out.push_str("  }\n");
}

fn split_ips(ips: &[IpAddr]) -> (Vec<String>, Vec<String>) {
    let mut v4 = Vec::new();
    let mut v6 = Vec::new();
    for ip in ips {
        match ip {
            IpAddr::V4(a) => v4.push(a.to_string()),
            IpAddr::V6(a) => v6.push(a.to_string()),
        }
    }
    (v4, v6)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    #[test]
    fn blacklist_uses_focusd_style_ip_sets() {
        let ips = [
            IpAddr::V4(Ipv4Addr::new(151, 101, 1, 140)),
            IpAddr::V6(Ipv6Addr::LOCALHOST),
        ];
        let s = ruleset(Mode::Blacklist, &ips, &[]);
        assert!(s.contains("table inet focuslock"));
        assert!(s.contains("set blocked_ips_v4"));
        assert!(s.contains("151.101.1.140"));
        assert!(s.contains("ip daddr @blocked_ips_v4 drop"));
        assert!(s.contains("ip6 daddr @blocked_ips_v6 drop"));
    }

    #[test]
    fn block_all_drops_web_egress() {
        let s = ruleset(Mode::BlockAll, &[], &[]);
        assert!(s.contains("tcp dport { 80, 443 } drop"));
        assert!(s.contains("udp dport 443 drop"));
    }
}
