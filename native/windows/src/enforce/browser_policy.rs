//! Enterprise browser-policy blocking (architecture §4.1).
//!
//! Chromium browsers (Chrome/Edge/Brave/Chromium) honor the managed `URLBlocklist` /
//! `URLAllowlist` policies, configured via HKLM registry keys that our `LocalSystem` service can
//! write. The browser enforces these at the **request** layer — above the socket — so they defeat
//! the pooled/coalesced-socket reuse the packet layer can't see (a reused HTTP/2 socket still has
//! each request checked against the policy), and a machine policy can't be overridden by the user.
//! Chromium watches the policy registry keys (`RegNotifyChangeKeyValue`) and reloads within a few
//! seconds of our write *or* delete, so focus-on and focus-off both reflect near-live.
//!
//! **Firefox is intentionally excluded.** Firefox reads enterprise policies only once, at startup,
//! with no runtime refresh — so our focus-on write is invisible until a restart, and (worse) our
//! focus-off *delete* is too: a Firefox that had picked up the block would keep enforcing it after
//! the user legitimately ends focus, until its next restart. Rather than block-after-unlock,
//! Firefox relies on the network layer (SetTcpEntry / per-flow drop / taint / DNS / SNI), which
//! toggles correctly and instantly in both directions.
//!
//! This *complements* the WinDivert/firewall layers; it does not replace them. It only covers
//! Chromium, so other browsers, non-browser apps, and raw-IP traffic still rely on the network
//! enforcement. Lifecycle mirrors the firewall backstop: written on focus-on / policy-change,
//! removed by `teardown_network` (focus-off + killswitch).
//!
//! We write via `reg import` of a generated `.reg` file (one process regardless of list size),
//! and clear by deleting just our own policy subkeys — never the whole browser policy key, so an
//! org's other managed policies are left intact.

use crate::model::{Mode, Policy};
use crate::run::run_command;

/// Chromium policy roots under HKLM. All share the `URLBlocklist` / `URLAllowlist` schema.
const CHROMIUM_ROOTS: &[&str] = &[
    r"SOFTWARE\Policies\Google\Chrome",
    r"SOFTWARE\Policies\Microsoft\Edge",
    r"SOFTWARE\Policies\BraveSoftware\Brave",
    r"SOFTWARE\Policies\Chromium",
];

/// Apply the managed blocklist for `policy` to every supported browser. Clears first so a
/// shrunk/edited list never leaves stale numbered entries behind.
pub fn apply(policy: &Policy) {
    clear();
    let content = build_reg(policy);
    let path = std::env::temp_dir().join("focuslock-browser-policy.reg");
    if let Err(e) = std::fs::write(&path, content) {
        tracing::warn!("write browser-policy .reg failed: {e}");
        return;
    }
    if let Some(p) = path.to_str() {
        run_command("reg", &["import", p], "import browser policy");
    }
}

/// Remove every policy subkey we own, across all supported browsers. Safe to call when nothing
/// was set (a missing key just logs a benign non-zero exit, like the netsh delete path).
pub fn clear() {
    for root in CHROMIUM_ROOTS {
        delete_key(&format!(r"HKLM\{root}\URLBlocklist"));
        delete_key(&format!(r"HKLM\{root}\URLAllowlist"));
    }
    // We no longer *write* a Firefox policy (startup-only reads make it block-after-unlock), but
    // keep deleting the key so any policy a prior build wrote is torn down on the next focus-off.
    delete_key(r"HKLM\SOFTWARE\Policies\Mozilla\Firefox\WebsiteFilter");
}

fn delete_key(path: &str) {
    run_command(
        "reg",
        &["delete", path, "/f"],
        &format!("clear browser policy {path}"),
    );
}

/// Build the `.reg` file body for the policy across all Chromium browsers.
fn build_reg(policy: &Policy) -> String {
    let mut s = String::from("Windows Registry Editor Version 5.00\r\n\r\n");
    let (cblock, callow) = chromium_entries(policy);
    for root in CHROMIUM_ROOTS {
        s.push_str(&reg_section(
            &format!(r"HKEY_LOCAL_MACHINE\{root}\URLBlocklist"),
            &cblock,
        ));
        if !callow.is_empty() {
            s.push_str(&reg_section(
                &format!(r"HKEY_LOCAL_MACHINE\{root}\URLAllowlist"),
                &callow,
            ));
        }
    }
    s
}

/// One `[key]` section with 1-based string values, matching the `URLBlocklist` numbered-value
/// schema Chromium expects.
fn reg_section(keypath: &str, entries: &[String]) -> String {
    let mut s = format!("[{keypath}]\r\n");
    for (i, e) in entries.iter().enumerate() {
        s.push_str(&format!("\"{}\"=\"{}\"\r\n", i + 1, reg_escape(e)));
    }
    s.push_str("\r\n");
    s
}

/// Escape a `.reg` string value: backslash and double-quote are the only specials in the values
/// we emit (domains / match patterns).
fn reg_escape(v: &str) -> String {
    v.replace('\\', r"\\").replace('"', "\\\"")
}

/// Chromium `(URLBlocklist, URLAllowlist)` entries. A bare host (`x.com`) blocks the host and all
/// subdomains, schemes, and paths; `*` blocks everything (with the allowlist as the exception).
fn chromium_entries(policy: &Policy) -> (Vec<String>, Vec<String>) {
    match policy.mode {
        Mode::Blacklist => (policy.domains.clone(), Vec::new()),
        Mode::Whitelist => (vec!["*".to_string()], policy.domains.clone()),
        Mode::BlockAll => (vec!["*".to_string()], Vec::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy(mode: Mode, domains: &[&str]) -> Policy {
        Policy {
            mode,
            domains: domains.iter().map(|s| s.to_string()).collect(),
            apps: Vec::new(),
        }
    }

    #[test]
    fn blacklist_blocks_listed_domains() {
        let (block, allow) = chromium_entries(&policy(Mode::Blacklist, &["x.com", "twimg.com"]));
        assert_eq!(block, vec!["x.com", "twimg.com"]);
        assert!(allow.is_empty());
    }

    #[test]
    fn whitelist_blocks_all_allows_listed() {
        let (block, allow) = chromium_entries(&policy(Mode::Whitelist, &["wikipedia.org"]));
        assert_eq!(block, vec!["*"]);
        assert_eq!(allow, vec!["wikipedia.org"]);
    }

    #[test]
    fn block_all_blocks_everything() {
        let (block, allow) = chromium_entries(&policy(Mode::BlockAll, &[]));
        assert_eq!(block, vec!["*"]);
        assert!(allow.is_empty());
    }

    #[test]
    fn reg_body_has_sections_and_numbered_values() {
        let body = build_reg(&policy(Mode::Blacklist, &["x.com"]));
        assert!(body.starts_with("Windows Registry Editor Version 5.00"));
        assert!(body.contains(r"[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Google\Chrome\URLBlocklist]"));
        assert!(body.contains("\"1\"=\"x.com\""));
        // Firefox is intentionally excluded (startup-only policy reads — see module docs).
        assert!(!body.contains("Mozilla"));
    }

    #[test]
    fn reg_escape_handles_quote_and_backslash() {
        assert_eq!(reg_escape(r#"a\b"c"#), r#"a\\b\"c"#);
    }
}
