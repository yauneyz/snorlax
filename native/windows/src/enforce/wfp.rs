//! Network firewall rules (architecture §4.1).
//!
//! v1 uses the Windows Firewall — which is itself a front-end to the Windows Filtering
//! Platform (WFP) — via `netsh advfirewall`, so no kernel callout or hand-written FWPM FFI is
//! needed and the build stays reliable. We block DNS-over-TLS/DoQ (port 853) and 443 to known
//! public DoH resolver IPs so a client can't use encrypted DNS to bypass the loopback
//! sinkhole. (Hostname-configured DoH endpoints are caught earlier: the sinkhole refuses to
//! resolve them — see policy_match::DOH_BYPASS_HOSTS.)
//!
//! Hardening upgrade (deferred, documented in lib.rs): open the BFE engine directly and add
//! provider-owned, boot-time-persistent FWPM filters with weight-based permit-exceptions
//! (which `netsh` block>allow precedence can't express), plus whitelist/block-all
//! ALE_AUTH_CONNECT filters.

use crate::run::run_command;

const DOT_TCP_RULE: &str = "Talysman-DoT-TCP";
const DOT_UDP_RULE: &str = "Talysman-DoT-UDP";
const DOH_TCP_RULE: &str = "Talysman-DoH-TCP";
const DOH_UDP_RULE: &str = "Talysman-DoH-UDP";
const QUIC_UDP_RULE: &str = "Talysman-QUIC-UDP";

/// Well-known public DoH resolver endpoint IPs (v4 + v6, CIDR where providers use anycast
/// ranges). Blocking 443 to these closes the hardcoded-IP DoH path; an app would need an
/// unknown resolver IP to slip through. The sinkhole's own upstream (UDP 53) is unaffected —
/// these rules are scoped to port 443.
const DOH_RESOLVER_IPS: &[&str] = &[
    // Cloudflare (incl. security/family variants)
    "1.1.1.1",
    "1.0.0.1",
    "1.1.1.2",
    "1.0.0.2",
    "1.1.1.3",
    "1.0.0.3",
    "2606:4700:4700::1111",
    "2606:4700:4700::1001",
    "2606:4700:4700::1112",
    "2606:4700:4700::1002",
    "2606:4700:4700::1113",
    "2606:4700:4700::1003",
    // Google
    "8.8.8.8",
    "8.8.4.4",
    "2001:4860:4860::8888",
    "2001:4860:4860::8844",
    // Quad9
    "9.9.9.9",
    "9.9.9.10",
    "9.9.9.11",
    "149.112.112.112",
    "149.112.112.10",
    "149.112.112.11",
    "2620:fe::fe",
    "2620:fe::9",
    "2620:fe::10",
    "2620:fe::11",
    // OpenDNS (incl. FamilyShield)
    "208.67.222.222",
    "208.67.220.220",
    "208.67.222.123",
    "208.67.220.123",
    "2620:119:35::35",
    "2620:119:53::53",
    // AdGuard
    "94.140.14.14",
    "94.140.15.15",
    "94.140.14.15",
    "94.140.15.16",
    "2a10:50c0::ad1:ff",
    "2a10:50c0::ad2:ff",
    "2a10:50c0::bad1:ff",
    "2a10:50c0::bad2:ff",
    // NextDNS (anycast)
    "45.90.28.0/24",
    "45.90.30.0/24",
    "2a07:a8c0::/32",
    "2a07:a8c1::/32",
    // CleanBrowsing
    "185.228.168.0/24",
    "185.228.169.0/24",
    // Mullvad
    "194.242.2.0/24",
];

/// Block outbound DNS-over-TLS / DNS-over-QUIC (port 853), TCP and UDP.
pub fn block_dns_over_tls() {
    add_block_rule(DOT_TCP_RULE, "TCP", 853, None);
    add_block_rule(DOT_UDP_RULE, "UDP", 853, None);
}

/// Block outbound 443 to known public DoH resolver IPs (TCP for HTTP/2, UDP for HTTP/3).
pub fn block_doh_resolvers() {
    let ips = DOH_RESOLVER_IPS.join(",");
    add_block_rule(DOH_TCP_RULE, "TCP", 443, Some(&ips));
    add_block_rule(DOH_UDP_RULE, "UDP", 443, Some(&ips));
}

/// Block all outbound UDP 443 (HTTP/3 / QUIC). This forces browsers to fall back to TCP, where the
/// DNS sinkhole, IP-drop layer, and extension request rules are the intended enforcement path.
/// Trade-off: a possible one-time TCP-fallback delay on h3 sites while focused; bulk throughput is
/// unaffected.
///
/// This rule is the kill-resistant *backstop*: the primary QUIC kill is the data-plane drop in
/// the WinDivert layer (enforce::divert), which also starves QUIC sessions that were already
/// established when focus turned on — a firewall rule added mid-flow may not cut those (WFP flow
/// reauthorization is not reliable for them).
pub fn block_quic() {
    add_block_rule(QUIC_UDP_RULE, "UDP", 443, None);
}

/// Remove all Talysman firewall rules.
pub fn clear_rules() {
    delete_rule(DOT_TCP_RULE);
    delete_rule(DOT_UDP_RULE);
    delete_rule(DOH_TCP_RULE);
    delete_rule(DOH_UDP_RULE);
    delete_rule(QUIC_UDP_RULE);
}

fn add_block_rule(name: &str, protocol: &str, port: u16, remote_ips: Option<&str>) {
    // Delete any stale copy first so we don't stack duplicates across restarts.
    delete_rule(name);
    // Owned strings first — array literals need uniform &str, so we bind then borrow.
    let name_arg = format!("name={name}");
    let proto_arg = format!("protocol={protocol}");
    let port_arg = format!("remoteport={port}");
    let mut args = vec![
        "advfirewall",
        "firewall",
        "add",
        "rule",
        name_arg.as_str(),
        "dir=out",
        "action=block",
        proto_arg.as_str(),
        port_arg.as_str(),
    ];
    let ip_arg = remote_ips.map(|ips| format!("remoteip={ips}"));
    if let Some(ip_arg) = &ip_arg {
        args.push(ip_arg.as_str());
    }
    run_command("netsh", &args, &format!("add firewall block rule {name}"));
}

fn delete_rule(name: &str) {
    let name_arg = format!("name={name}");
    run_command(
        "netsh",
        &["advfirewall", "firewall", "delete", "rule", &name_arg],
        &format!("delete firewall rule {name}"),
    );
}
