//! Network firewall rules (architecture §4.1).
//!
//! v1 uses the Windows Firewall — which is itself a front-end to the Windows Filtering
//! Platform (WFP) — via `netsh advfirewall`, so no kernel callout or hand-written FWPM FFI is
//! needed and the build stays reliable. We block DNS-over-TLS (port 853) so a client can't use
//! DoT to bypass the loopback sinkhole.
//!
//! Hardening upgrade (deferred, documented in lib.rs): open the BFE engine directly and add
//! provider-owned, boot-time-persistent FWPM filters with weight-based permit-exceptions
//! (which `netsh` block>allow precedence can't express), plus whitelist/block-all
//! ALE_AUTH_CONNECT filters and a maintained DoH-endpoint IP blocklist.

use crate::run::run_command;

const DOT_TCP_RULE: &str = "FocusLock-DoT-TCP";
const DOT_UDP_RULE: &str = "FocusLock-DoT-UDP";

/// Block outbound DNS-over-TLS (port 853), TCP and UDP.
pub fn block_dns_over_tls() {
    add_block_rule(DOT_TCP_RULE, "TCP", 853);
    add_block_rule(DOT_UDP_RULE, "UDP", 853);
}

/// Remove all FocusLock firewall rules.
pub fn clear_rules() {
    delete_rule(DOT_TCP_RULE);
    delete_rule(DOT_UDP_RULE);
}

fn add_block_rule(name: &str, protocol: &str, port: u16) {
    // Delete any stale copy first so we don't stack duplicates across restarts.
    delete_rule(name);
    // Owned strings first — array literals need uniform &str, so we bind then borrow.
    let name_arg = format!("name={name}");
    let proto_arg = format!("protocol={protocol}");
    let port_arg = format!("remoteport={port}");
    run_command(
        "netsh",
        &[
            "advfirewall",
            "firewall",
            "add",
            "rule",
            &name_arg,
            "dir=out",
            "action=block",
            &proto_arg,
            &port_arg,
        ],
        &format!("add firewall block rule {name}"),
    );
}

fn delete_rule(name: &str) {
    let name_arg = format!("name={name}");
    run_command(
        "netsh",
        &["advfirewall", "firewall", "delete", "rule", &name_arg],
        &format!("delete firewall rule {name}"),
    );
}
