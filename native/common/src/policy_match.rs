//! Pure domain matching against a [`Policy`], shared by every native backend. Mirrors the intent
//! of `packages/core/src/policyNormalize.ts` matching (wildcards are a leading "*.").
//!
//! This is the half of policy matching that depends on the *policy schema* rather than on the OS,
//! so it lives beside the model in [`crate::policy`]. Each backend still owns the parts that are
//! genuinely platform-specific — the browser image-name table and app matching, which differ by
//! executable naming convention (`chrome.exe` vs `google-chrome`).

use crate::policy::{AppRef, DefaultAction, Policy};

/// Does `host` match `pattern`? `pattern` may be exact ("youtube.com") or a leading wildcard
/// ("*.reddit.com" matches reddit.com and any subdomain).
pub fn host_matches(host: &str, pattern: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    let pattern = pattern.trim().to_ascii_lowercase();
    if let Some(base) = pattern.strip_prefix("*.") {
        host == base || host.ends_with(&format!(".{base}"))
    } else {
        host == pattern || host.ends_with(&format!(".{pattern}"))
    }
}

/// Should a DNS query for `host` be blocked under `policy`? `blockedDomains` and `allowedDomains`
/// are hard, never-judged lists (block wins if a domain is somehow on both — see
/// `packages/core/src/policyNormalize.ts`); anything on neither list falls back to
/// `defaultAction`. `intent`-based Smart-filtering judgments happen at the page level in the
/// browser extension, not here — the OS-level DNS/packet layer only ever sees the hard lists
/// and the default.
pub fn is_host_blocked(policy: &Policy, host: &str) -> bool {
    if policy.blocked_domains.iter().any(|p| host_matches(host, p)) {
        return true;
    }
    if policy.allowed_domains.iter().any(|p| host_matches(host, p)) {
        return false;
    }
    policy.default_action == DefaultAction::Block
}

/// A dot-less host that matches no realistic domain pattern (only an exact-equality pattern for
/// this exact string could match it). It stands in for the "matches nothing listed" class when
/// comparing block coverage.
const NO_MATCH_SENTINEL: &str = "talysmannomatchsentinelhost";

fn norm_app_field(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(|v| v.trim().trim_end_matches(".exe").to_ascii_lowercase())
        .filter(|v| !v.is_empty())
}

/// Do two app references identify the same executable (ignoring the human label)?
fn same_app(a: &AppRef, b: &AppRef) -> bool {
    norm_app_field(&a.linux_process_name) == norm_app_field(&b.linux_process_name)
        && norm_app_field(&a.windows_image_name) == norm_app_field(&b.windows_image_name)
        && norm_app_field(&a.mac_bundle_id) == norm_app_field(&b.mac_bundle_id)
}

/// Whether `next` blocks at least everything `prev` blocked. Domains: every host `prev` sinkholes,
/// `next` must sinkhole too — checked over the base of each listed pattern plus a non-matching
/// sentinel, which is a sound and complete witness set for `is_host_blocked`. Apps: `next` must
/// still block every app `prev` blocked. Equal or stricter policies return true; any relaxation
/// (unblocking a site or app, or a `defaultAction` change that frees traffic) returns false.
///
/// This is what gates un-keyed policy edits: loosening enforcement requires the USB key, so a
/// false here is what forces the prompt.
pub fn is_at_least_as_restrictive(prev: &Policy, next: &Policy) -> bool {
    let mut hosts: Vec<String> = Vec::new();
    for pattern in prev
        .blocked_domains
        .iter()
        .chain(prev.allowed_domains.iter())
        .chain(next.blocked_domains.iter())
        .chain(next.allowed_domains.iter())
    {
        let base = pattern
            .trim()
            .trim_start_matches("*.")
            .trim_end_matches('.')
            .to_ascii_lowercase();
        if !base.is_empty() {
            hosts.push(base);
        }
    }
    hosts.push(NO_MATCH_SENTINEL.to_string());

    for host in &hosts {
        if is_host_blocked(prev, host) && !is_host_blocked(next, host) {
            return false;
        }
    }

    prev.apps
        .iter()
        .all(|app| next.apps.iter().any(|candidate| same_app(candidate, app)))
}

/// Hostnames a DNS sinkhole must refuse while focus is active, independent of the user's policy,
/// because they exist to bypass local DNS filtering.
pub const DOH_BYPASS_HOSTS: &[&str] = &[
    "use-application-dns.net", // Firefox canary
    "dns.google",
    "dns.google.com",
    "cloudflare-dns.com",
    "one.one.one.one",
    "dns.quad9.net",
    "dns9.quad9.net",
    "dns10.quad9.net",
    "dns11.quad9.net",
    "doh.opendns.com",
    "familyshield.opendns.com",
    "adguard-dns.com",
    "dns.nextdns.io",
    "doh.cleanbrowsing.org",
    "dns.mullvad.net",
    "doh.xfinity.com",
    "dns0.eu",
    "doh.dns.sb",
    "dns.brave.com",
    "doh.pub",
    "dns.alidns.com",
];

/// Is `host` a DoH endpoint / canary that must be sinkholed while focus is active?
pub fn is_doh_bypass_host(host: &str) -> bool {
    DOH_BYPASS_HOSTS.iter().any(|p| host_matches(host, p))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy(blocked: &[&str], allowed: &[&str], default_action: DefaultAction) -> Policy {
        Policy {
            blocked_domains: blocked.iter().map(|s| (*s).into()).collect(),
            allowed_domains: allowed.iter().map(|s| (*s).into()).collect(),
            default_action,
            intent: None,
            apps: Vec::new(),
        }
    }

    #[test]
    fn host_matching_covers_subdomains_and_wildcards() {
        assert!(host_matches("reddit.com", "reddit.com"));
        assert!(host_matches("www.reddit.com", "reddit.com"));
        assert!(host_matches("a.b.reddit.com", "*.reddit.com"));
        assert!(host_matches("reddit.com", "*.reddit.com"));
        assert!(host_matches("REDDIT.COM", "reddit.com"));
        assert!(host_matches("reddit.com.", "reddit.com"));
        assert!(!host_matches("notreddit.com", "reddit.com"));
        assert!(!host_matches("reddit.com.evil.com", "reddit.com"));
    }

    #[test]
    fn blocked_list_wins_and_allow_list_exempts() {
        let p = policy(&["reddit.com"], &["docs.reddit.com"], DefaultAction::Allow);
        assert!(is_host_blocked(&p, "reddit.com"));
        // Block wins when a host matches both lists — the normalizer is expected to prevent this,
        // but enforcement must fail safe if it ever slips through.
        assert!(is_host_blocked(&p, "docs.reddit.com"));
        assert!(!is_host_blocked(&p, "example.com"));
    }

    #[test]
    fn default_action_governs_hosts_on_neither_list() {
        let open = policy(&[], &[], DefaultAction::Allow);
        assert!(!is_host_blocked(&open, "example.com"));

        let closed = policy(&[], &["docs.rs"], DefaultAction::Block);
        assert!(is_host_blocked(&closed, "example.com"));
        assert!(!is_host_blocked(&closed, "docs.rs"));
        assert!(!is_host_blocked(&closed, "sub.docs.rs"));
    }

    #[test]
    fn adding_a_blocked_domain_is_more_restrictive() {
        let prev = policy(&["reddit.com"], &[], DefaultAction::Allow);
        let next = policy(&["reddit.com", "x.com"], &[], DefaultAction::Allow);
        assert!(is_at_least_as_restrictive(&prev, &next));
        assert!(!is_at_least_as_restrictive(&next, &prev));
    }

    #[test]
    fn switching_the_default_to_block_is_more_restrictive() {
        let open = policy(&[], &[], DefaultAction::Allow);
        let closed = policy(&[], &[], DefaultAction::Block);
        assert!(is_at_least_as_restrictive(&open, &closed));
        assert!(!is_at_least_as_restrictive(&closed, &open));
    }

    /// Widening an allow list under a block-by-default policy frees traffic, so it must be
    /// treated as a relaxation and require the key.
    #[test]
    fn widening_an_allow_list_is_a_relaxation() {
        let prev = policy(&[], &["docs.rs"], DefaultAction::Block);
        let next = policy(&[], &["docs.rs", "reddit.com"], DefaultAction::Block);
        assert!(!is_at_least_as_restrictive(&prev, &next));
        assert!(is_at_least_as_restrictive(&next, &prev));
    }

    #[test]
    fn an_identical_policy_is_at_least_as_restrictive() {
        let p = policy(&["reddit.com"], &["docs.rs"], DefaultAction::Block);
        assert!(is_at_least_as_restrictive(&p, &p));
    }

    #[test]
    fn dropping_a_blocked_app_is_a_relaxation() {
        let app = |name: &str| AppRef {
            windows_image_name: Some(name.into()),
            linux_process_name: None,
            mac_bundle_id: None,
            label: name.into(),
        };
        let mut prev = policy(&[], &[], DefaultAction::Allow);
        prev.apps = vec![app("chrome.exe")];
        let next = policy(&[], &[], DefaultAction::Allow);
        assert!(!is_at_least_as_restrictive(&prev, &next));
        assert!(is_at_least_as_restrictive(&next, &prev));
    }

    /// `.exe` is stripped when comparing, so the same app authored from different platforms is
    /// recognized as the same executable and does not read as a relaxation.
    #[test]
    fn app_identity_ignores_the_exe_suffix_and_label() {
        let mut prev = policy(&[], &[], DefaultAction::Allow);
        prev.apps = vec![AppRef {
            windows_image_name: Some("Chrome.exe".into()),
            linux_process_name: None,
            mac_bundle_id: None,
            label: "Chrome".into(),
        }];
        let mut next = policy(&[], &[], DefaultAction::Allow);
        next.apps = vec![AppRef {
            windows_image_name: Some("chrome".into()),
            linux_process_name: None,
            mac_bundle_id: None,
            label: "Google Chrome".into(),
        }];
        assert!(is_at_least_as_restrictive(&prev, &next));
    }

    #[test]
    fn doh_endpoints_and_the_firefox_canary_are_bypass_hosts() {
        assert!(is_doh_bypass_host("dns.google"));
        assert!(is_doh_bypass_host("use-application-dns.net"));
        assert!(is_doh_bypass_host("chrome.cloudflare-dns.com"));
        assert!(!is_doh_bypass_host("example.com"));
    }
}
