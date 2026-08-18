//! pf (packet filter) output enforcement for macOS.
//!
//! Rules are loaded into the anchor `com.apple/talysman`. The stock macOS /etc/pf.conf contains
//! `anchor "com.apple/*"`, so a sub-anchor there is evaluated without editing pf.conf at all.
//! pf tables hold IPv4 and IPv6 addresses together, so no v4/v6 set split is needed. pf cannot
//! negate a table match, so whitelist mode is expressed as `pass out quick` to the allowed table
//! followed by `block drop out quick` on the web ports (`quick` is terminal across the ruleset).

use std::io::Write;
use std::net::IpAddr;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Duration;

use crate::enforce::EnforceShared;
use crate::model::DefaultAction;

pub const ANCHOR: &str = "com.apple/talysman";
const IDLE_WAIT: Duration = Duration::from_secs(60 * 60);
const RETRY_WAIT: Duration = Duration::from_secs(5);

pub fn run_manager(shared: Arc<EnforceShared>, shutdown: tokio::sync::watch::Receiver<bool>) {
    let mut installed_gen: Option<u64> = None;
    let mut cleared_inactive = false;
    let mut observed = shared.change_generation();
    while !*shutdown.borrow() {
        if !shared.is_active() {
            if installed_gen.take().is_some() || !cleared_inactive {
                remove_rules();
                tracing::info!("pf rules removed (focus off)");
                cleared_inactive = true;
            }
            observed = shared.wait_for_change(observed, IDLE_WAIT);
            continue;
        }
        cleared_inactive = false;

        let gen = shared.generation();
        if installed_gen != Some(gen) {
            let default_action = shared.default_action();
            // Under `allow` only the blocked IP set matters; under `block` only the allow-list
            // exemptions do. The other set is dead weight in the ruleset either way.
            let blocked = if default_action == DefaultAction::Allow {
                shared.blocked_ips()
            } else {
                Vec::new()
            };
            let allowed = if default_action == DefaultAction::Block {
                shared.allowed_ips()
            } else {
                Vec::new()
            };
            let script = ruleset(default_action, &blocked, &allowed);
            ensure_pf_enabled();
            if apply_script(&script) {
                installed_gen = Some(gen);
                tracing::info!("pf rules applied for {:?}", default_action);
            }
        }
        let wait = if installed_gen == Some(gen) {
            IDLE_WAIT
        } else {
            RETRY_WAIT
        };
        observed = shared.wait_for_change(observed, wait);
    }
}

/// Flush everything Talysman loaded into its anchor. An empty anchor is inert; the stock
/// `com.apple/*` anchor line in pf.conf stays untouched.
pub fn remove_rules() {
    let _ = Command::new("pfctl")
        .args(["-a", ANCHOR, "-F", "all"])
        .output();
}

/// Make sure pf itself is running. Check first (`pfctl -s info`) so we don't bump the `-E`
/// enable reference count on every reinstall — macOS tracks nested enables, and leaking
/// references would keep pf on after our token is released.
fn ensure_pf_enabled() {
    let status = Command::new("pfctl").args(["-s", "info"]).output();
    if let Ok(out) = &status {
        let text = String::from_utf8_lossy(&out.stdout);
        if text.contains("Status: Enabled") {
            return;
        }
    }
    match Command::new("pfctl").arg("-E").output() {
        Ok(out) if out.status.success() => {
            tracing::info!("pf enabled");
        }
        Ok(out) => tracing::warn!(
            "pfctl -E failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ),
        Err(e) => tracing::warn!("failed to spawn pfctl: {e}"),
    }
}

/// Load `script` into the Talysman anchor, replacing whatever was there.
fn apply_script(script: &str) -> bool {
    let mut child = match Command::new("pfctl")
        .args(["-a", ANCHOR, "-f", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            tracing::warn!("failed to spawn pfctl: {e}");
            return false;
        }
    };
    if let Some(mut stdin) = child.stdin.take() {
        if let Err(e) = stdin.write_all(script.as_bytes()) {
            tracing::warn!("failed to write pf ruleset: {e}");
            return false;
        }
    }
    match child.wait_with_output() {
        Ok(out) if out.status.success() => true,
        Ok(out) => {
            tracing::warn!(
                "pfctl failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            );
            false
        }
        Err(e) => {
            tracing::warn!("failed waiting for pfctl: {e}");
            false
        }
    }
}

/// `defaultAction: allow` drops only the resolved `blockedDomains` IPs. `defaultAction: block`
/// default-denies web egress and passes the resolved `allowedDomains` IPs through — with an empty
/// allow list that collapses to the old "block-all" ceiling, which is exactly what it means.
fn ruleset(default_action: DefaultAction, blocked: &[IpAddr], allowed: &[IpAddr]) -> String {
    let mut s = String::new();
    // DoT is always dropped while focus is active, whatever the default is.
    let dot_block = "block drop out quick proto tcp to any port 853\n\
                     block drop out quick proto udp to any port 853\n";
    match default_action {
        DefaultAction::Allow => {
            if !blocked.is_empty() {
                s.push_str(&table("talysman_blocked", blocked));
            }
            s.push_str(dot_block);
            if !blocked.is_empty() {
                s.push_str("block drop out quick to <talysman_blocked>\n");
            }
        }
        DefaultAction::Block => {
            if !allowed.is_empty() {
                s.push_str(&table("talysman_allowed", allowed));
            }
            s.push_str(dot_block);
            if !allowed.is_empty() {
                s.push_str(
                    "pass out quick proto tcp to <talysman_allowed> port { 80, 443 }\n\
                     pass out quick proto udp to <talysman_allowed> port 443\n",
                );
            }
            s.push_str(
                "block drop out quick proto tcp to any port { 80, 443 }\n\
                 block drop out quick proto udp to any port 443\n",
            );
        }
    }
    s
}

fn table(name: &str, ips: &[IpAddr]) -> String {
    let elems: Vec<String> = ips.iter().map(|ip| ip.to_string()).collect();
    format!("table <{name}> {{ {} }}\n", elems.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    #[test]
    fn an_open_default_builds_a_mixed_drop_table() {
        let ips = [
            IpAddr::V4(Ipv4Addr::new(151, 101, 1, 140)),
            IpAddr::V6(Ipv6Addr::LOCALHOST),
        ];
        let s = ruleset(DefaultAction::Allow, &ips, &[]);
        assert!(s.contains("table <talysman_blocked> { 151.101.1.140, ::1 }"));
        assert!(s.contains("block drop out quick to <talysman_blocked>"));
        assert!(s.contains("port 853"));
    }

    #[test]
    fn an_open_default_with_no_ips_still_blocks_dot() {
        let s = ruleset(DefaultAction::Allow, &[], &[]);
        assert!(!s.contains("table <"));
        assert!(!s.contains("<talysman_blocked>"));
        assert!(s.contains("block drop out quick proto tcp to any port 853"));
    }

    #[test]
    fn a_closed_default_passes_the_allow_list_then_blocks_web_ports() {
        let ips = [IpAddr::V4(Ipv4Addr::new(1, 2, 3, 4))];
        let s = ruleset(DefaultAction::Block, &[], &ips);
        assert!(s.contains("table <talysman_allowed> { 1.2.3.4 }"));
        let pass = s
            .find("pass out quick proto tcp to <talysman_allowed> port { 80, 443 }")
            .unwrap();
        let block = s
            .find("block drop out quick proto tcp to any port { 80, 443 }")
            .unwrap();
        assert!(pass < block, "pass rules must precede the block backstop");
        assert!(s.contains("pass out quick proto udp to <talysman_allowed> port 443"));
    }

    #[test]
    fn a_closed_default_with_no_ips_blocks_all_web_egress() {
        let s = ruleset(DefaultAction::Block, &[], &[]);
        assert!(!s.contains("pass out"));
        assert!(s.contains("block drop out quick proto tcp to any port { 80, 443 }"));
        assert!(s.contains("block drop out quick proto udp to any port 443"));
    }

    #[test]
    fn the_old_block_all_preset_still_drops_web_egress() {
        let s = ruleset(DefaultAction::Block, &[], &[]);
        assert!(s.contains("block drop out quick proto tcp to any port { 80, 443 }"));
        assert!(s.contains("block drop out quick proto udp to any port 443"));
        assert!(!s.contains("table <"));
    }
}
