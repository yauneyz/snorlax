//! Pure domain matching against a [`Policy`], shared by every native backend. Mirrors the intent
//! of `packages/core/src/policyNormalize.ts` matching (wildcards are a leading "*.").
//!
//! This is the half of policy matching that depends on the *policy schema* rather than on the OS,
//! so it lives beside the model in [`crate::policy`]. Each backend still owns the parts that are
//! genuinely platform-specific — the browser image-name table and app matching, which differ by
//! executable naming convention (`chrome.exe` vs `google-chrome`).

use crate::policy::{AppRef, DefaultAction, Policy};
use crate::premade_lists;

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
/// `packages/core/src/policyNormalize.ts`); `allowedDomains` also exempts a host from the
/// built-in premade lists (`enabledPremadeLists`), which are checked next — this is the escape
/// hatch for a user who wants a category blocked except for one site. Anything on neither hard
/// list and not in an enabled premade list falls back to `defaultAction`, UNLESS `intent` is set,
/// in which case unlisted hosts are let through so the page can load and the browser extension's
/// `judgeRequest` gets a chance to run. `defaultAction` still applies in that case — just as the
/// fail-closed/fail-open fallback if the judge never answers (see
/// `platform_core::sweep_expired_judges`), not as a live gate here.
pub fn is_host_blocked(policy: &Policy, host: &str) -> bool {
    if policy.blocked_domains.iter().any(|p| host_matches(host, p)) {
        return true;
    }
    if policy.allowed_domains.iter().any(|p| host_matches(host, p)) {
        return false;
    }
    if policy.soft_blocked_sites.iter().any(|site| site.network_domains().iter().any(|domain| host_matches(host, domain))) {
        return false;
    }
    if premade_lists::is_blocked_by_premade(&policy.enabled_premade_lists, host) {
        return true;
    }
    if policy.intent.is_some() {
        // Smart filtering judges unlisted hosts at the page level (judgeRequest), which requires
        // the page to actually load. The DNS/packet layer must not preempt that by sinkholing on
        // `defaultAction` here — `defaultAction` still applies as the fail-closed/fail-open
        // fallback if the judge never answers (see platform_core::sweep_expired_judges).
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
    for site in prev.soft_blocked_sites.iter().chain(next.soft_blocked_sites.iter()) {
        hosts.extend(site.network_domains().iter().map(|domain| domain.to_string()));
    }
    hosts.push(NO_MATCH_SENTINEL.to_string());

    for host in &hosts {
        if is_host_blocked(prev, host) && !is_host_blocked(next, host) {
            return false;
        }
    }

    if !prev
        .apps
        .iter()
        .all(|app| next.apps.iter().any(|candidate| same_app(candidate, app)))
    {
        return false;
    }

    // Removing a soft block opens feeds even though both policies allow the hostname.
    if !prev.soft_blocked_sites.iter().all(|site| {
        next.soft_blocked_sites.contains(site)
            || next.blocked_domains.iter().any(|domain| host_matches(site.domain(), domain))
    }) {
        return false;
    }

    // Direct set comparison rather than sampling hosts from each list: the lists are fixed and
    // shipped with the app (not user-editable subsets), so "every list prev had enabled is still
    // enabled in next" is exactly the restrictiveness condition — turning one off always frees
    // traffic, turning one on never does.
    prev.enabled_premade_lists
        .iter()
        .all(|id| next.enabled_premade_lists.contains(id))
}

/// Domains a DNS-layer sinkhole (dnsmasq on Linux, the `/etc/hosts` splice on macOS) should
/// refuse: the user's own `blockedDomains` plus every domain in an enabled premade list, minus
/// anything exempted by `allowedDomains`. Deliberately NOT fed into the IP-resolution backstops
/// (pf/nftables/WinDivert IP tables) — those resolve every entry to an IP on a timer, and doing
/// that for tens of thousands of premade-list domains would be prohibitively expensive; premade
/// lists rely on the DNS layer alone.
pub fn effective_dns_sinkhole_domains(policy: &Policy) -> std::collections::BTreeSet<String> {
    let mut out: std::collections::BTreeSet<String> =
        policy.blocked_domains.iter().cloned().collect();
    for domain in premade_lists::expand_enabled(&policy.enabled_premade_lists) {
        if policy
            .allowed_domains
            .iter()
            .any(|p| host_matches(&domain, p))
            || policy.soft_blocked_sites.iter().any(|site| site.network_domains().iter().any(|network| host_matches(&domain, network)))
        {
            continue;
        }
        out.insert(domain);
    }
    out
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
            enabled_premade_lists: Vec::new(),
            soft_blocked_sites: Vec::new(),
        }
    }

    #[test]
    fn soft_block_is_a_key_gated_relaxation_of_a_hard_block() {
        use crate::policy::SoftBlockedSite;
        let hard = policy(&["reddit.com"], &[], DefaultAction::Allow);
        let mut soft = policy(&[], &[], DefaultAction::Allow);
        soft.soft_blocked_sites.push(SoftBlockedSite::Reddit);
        assert!(!is_at_least_as_restrictive(&hard, &soft));
        assert!(is_at_least_as_restrictive(&soft, &hard));
        assert!(!is_at_least_as_restrictive(&soft, &policy(&[], &[], DefaultAction::Allow)));
    }

    use crate::policy::PremadeListId;

    #[test]
    fn enabling_a_premade_list_blocks_its_domains() {
        let p = policy(&[], &[], DefaultAction::Allow);
        assert!(!is_host_blocked(&p, "amazon.com"));

        let mut with_shopping = p.clone();
        with_shopping.enabled_premade_lists = vec![PremadeListId::Shopping];
        assert!(is_host_blocked(&with_shopping, "amazon.com"));
        assert!(is_host_blocked(&with_shopping, "www.amazon.com"));
        // Not a subdomain wildcard: AWS console/login live under the same apex but must not be
        // collaterally blocked by the "shopping" list.
        assert!(!is_host_blocked(&with_shopping, "console.aws.amazon.com"));
        assert!(!is_host_blocked(&with_shopping, "signin.aws.amazon.com"));
    }

    #[test]
    fn allowed_domains_exempt_a_host_from_an_enabled_premade_list() {
        let mut p = policy(&[], &["amazon.com"], DefaultAction::Allow);
        p.enabled_premade_lists = vec![PremadeListId::Shopping];
        assert!(!is_host_blocked(&p, "amazon.com"));
        // Other shopping domains stay blocked.
        assert!(is_host_blocked(&p, "ebay.com"));
    }

    #[test]
    fn enabling_a_premade_list_is_more_restrictive_and_disabling_one_is_a_relaxation() {
        let mut off = policy(&[], &[], DefaultAction::Allow);
        let mut on = off.clone();
        on.enabled_premade_lists = vec![PremadeListId::Shopping];
        assert!(is_at_least_as_restrictive(&off, &on));
        assert!(!is_at_least_as_restrictive(&on, &off));

        off.enabled_premade_lists = vec![PremadeListId::Shopping, PremadeListId::Social];
        on.enabled_premade_lists = vec![PremadeListId::Shopping];
        assert!(!is_at_least_as_restrictive(&off, &on));
    }

    #[test]
    fn widening_the_allow_list_under_a_premade_list_is_a_relaxation() {
        let mut prev = policy(&[], &[], DefaultAction::Allow);
        prev.enabled_premade_lists = vec![PremadeListId::Shopping];
        let mut next = prev.clone();
        next.allowed_domains = vec!["amazon.com".into()];
        assert!(!is_at_least_as_restrictive(&prev, &next));
        assert!(is_at_least_as_restrictive(&next, &prev));
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

    /// With `intent` set, `defaultAction: Block` must not sinkhole unlisted hosts at the DNS
    /// layer — that would stop the page from ever loading, so the extension's `judgeRequest`
    /// (which is what's actually supposed to decide unlisted hosts) never runs.
    #[test]
    fn intent_lets_unlisted_hosts_through_regardless_of_default_action() {
        let mut smart = policy(&[], &[], DefaultAction::Block);
        smart.intent = Some(crate::policy::Intent {
            positive: "rust compilers".into(),
            negative: None,
        });
        assert!(!is_host_blocked(&smart, "example.com"));
        // Hard lists still win even with intent set.
        smart.blocked_domains = vec!["evil.com".into()];
        assert!(is_host_blocked(&smart, "evil.com"));
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
