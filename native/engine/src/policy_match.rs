//! Pure domain matching against a [`Policy`], shared by every native backend. Mirrors the intent
//! of `packages/core/src/policyNormalize.ts` matching (wildcards are a leading "*.").
//!
//! This is the half of policy matching that depends on the *policy schema* rather than on the OS,
//! so it lives beside the model in [`crate::policy`]. Each backend still owns the parts that are
//! genuinely platform-specific — the browser image-name table and app matching, which differ by
//! executable naming convention (`chrome.exe` vs `google-chrome`).

use crate::policy::{AppRef, Policy, RuleAction};
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

/// Is `host` served by an enabled site rule (the site's own hosts or its asset domains)?
pub fn is_site_network_host(policy: &Policy, host: &str) -> bool {
    policy
        .catalog_sites()
        .any(|(site, _)| site.all_domains().any(|domain| host_matches(host, domain)))
}

/// Should a DNS query for `host` be blocked under `policy`? This is the host-level projection of
/// the layer order every enforcer shares (see apps/extension/src/site-engine.js):
///
/// 1. `blockedDomains` — hard block.
/// 2. Site rules — an enabled catalog site's hosts and asset domains pass; the extension enforces
///    the site's per-feature rules page by page.
/// 3. `allowedDomains` — hard allow; also exempts a host from the premade lists, which is the
///    escape hatch for a user who wants a category blocked except for one site.
/// 4. `enabledPremadeLists` — block.
/// 5. `defaultAction` — `judge` lets the page load so the AI judge can read it; its fallback
///    applies later, per page (see `platform_core::sweep_expired_judges`), not here.
pub fn is_host_blocked(policy: &Policy, host: &str) -> bool {
    if policy.blocked_domains.iter().any(|p| host_matches(host, p)) {
        return true;
    }
    if is_site_network_host(policy, host) {
        return false;
    }
    if policy.allowed_domains.iter().any(|p| host_matches(host, p)) {
        return false;
    }
    if premade_lists::is_blocked_by_premade(&policy.enabled_premade_lists, host) {
        return true;
    }
    policy.default_action == RuleAction::Block
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
pub fn same_app(a: &AppRef, b: &AppRef) -> bool {
    norm_app_field(&a.linux_process_name) == norm_app_field(&b.linux_process_name)
        && norm_app_field(&a.windows_image_name) == norm_app_field(&b.windows_image_name)
        && norm_app_field(&a.mac_bundle_id) == norm_app_field(&b.mac_bundle_id)
        && norm_app_field(&a.android_package) == norm_app_field(&b.android_package)
}

/// Does `app` (a blocklist entry) identify the running `target`? Unlike [`same_app`], only the
/// fields the target actually carries are compared, so a desktop entry that names both a Windows
/// image and a Linux process still matches a Linux process by name alone.
pub fn app_matches(app: &AppRef, target: &AppRef) -> bool {
    let pairs = [
        (&app.android_package, &target.android_package),
        (&app.linux_process_name, &target.linux_process_name),
        (&app.windows_image_name, &target.windows_image_name),
        (&app.mac_bundle_id, &target.mac_bundle_id),
    ];
    pairs.iter().any(|(a, t)| {
        let (a, t) = (norm_app_field(a), norm_app_field(t));
        a.is_some() && a == t
    })
}

/// Whether `next` blocks at least everything `prev` blocked. Domains: every host `prev` sinkholes,
/// `next` must sinkhole too — checked over the base of each listed pattern plus a non-matching
/// sentinel, which is a sound and complete witness set for `is_host_blocked`. Apps: `next` must
/// still block every app `prev` blocked. Site rules: every feature of every site `prev` rules
/// must be at least as restricted in `next` (block > judge > allow), unless `next` hard-blocks the
/// whole site. The AI judge: `defaultAction` may not weaken (block > judge > allow), and the judge
/// may not be removed while `prev` relies on it — but editing tasks is not a relaxation, since
/// users must be able to update what they're working on mid-session. Equal or stricter policies
/// return true; any relaxation returns false. Mirrored in TS by
/// packages/core/src/restrictiveness.ts.
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
    hosts.extend(prev.site_network_domains());
    hosts.extend(next.site_network_domains());
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

    // Loosening or removing a site rule opens feeds even though both policies let the hostname
    // through. Hard-blocking the site's primary host instead is at least as restrictive.
    for (site, rule) in prev.catalog_sites() {
        let hard_blocked = site
            .hosts
            .first()
            .is_some_and(|host| next.blocked_domains.iter().any(|domain| host_matches(host, domain)));
        if hard_blocked {
            continue;
        }
        match next.sites.get(&site.id) {
            Some(after) if site.at_least_as_restrictive(Some(rule), Some(after)) => {}
            _ => return false,
        }
    }

    if next.default_action.rank() < prev.default_action.rank() {
        return false;
    }
    if prev.judge.is_some() && next.judge.is_none() && prev.uses_judge() {
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
            || is_site_network_host(policy, &domain)
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
    use crate::policy::DefaultAction;

    fn policy(blocked: &[&str], allowed: &[&str], default_action: RuleAction) -> Policy {
        Policy {
            blocked_domains: blocked.iter().map(|s| (*s).into()).collect(),
            allowed_domains: allowed.iter().map(|s| (*s).into()).collect(),
            default_action,
            judge: None,
            apps: Vec::new(),
            enabled_premade_lists: Vec::new(),
            sites: Default::default(),
        }
    }

    fn with_site(mut p: Policy, id: &str, features: &[(&str, RuleAction)]) -> Policy {
        p.sites.insert(
            id.into(),
            crate::policy::SiteRule { features: features.iter().map(|(f, a)| ((*f).into(), *a)).collect() },
        );
        p
    }

    #[test]
    fn a_site_rule_is_a_key_gated_relaxation_of_a_hard_block() {
        let hard = policy(&["reddit.com"], &[], RuleAction::Allow);
        let soft = with_site(policy(&[], &[], RuleAction::Allow), "reddit", &[]);
        assert!(!is_at_least_as_restrictive(&hard, &soft));
        assert!(is_at_least_as_restrictive(&soft, &hard));
        assert!(!is_at_least_as_restrictive(&soft, &policy(&[], &[], RuleAction::Allow)));
    }

    #[test]
    fn site_rules_let_site_and_asset_hosts_through_default_deny_and_premade_lists() {
        let mut p = with_site(policy(&[], &[], RuleAction::Block), "youtube", &[]);
        p.enabled_premade_lists = vec![PremadeListId::Social];
        assert!(!is_host_blocked(&p, "www.youtube.com"));
        assert!(!is_host_blocked(&p, "i.ytimg.com"));
        assert!(is_host_blocked(&p, "example.com"));
        p.blocked_domains = vec!["youtube.com".into()];
        assert!(is_host_blocked(&p, "www.youtube.com"));
    }

    #[test]
    fn loosening_any_feature_is_a_relaxation_and_tightening_is_not() {
        let base = with_site(policy(&[], &[], RuleAction::Allow), "youtube", &[]);
        let open_feed = with_site(policy(&[], &[], RuleAction::Allow), "youtube", &[("feed", RuleAction::Allow)]);
        let judged_feed = with_site(policy(&[], &[], RuleAction::Allow), "youtube", &[("feed", RuleAction::Judge)]);
        let blocked_content = with_site(policy(&[], &[], RuleAction::Allow), "youtube", &[("content", RuleAction::Block)]);
        assert!(!is_at_least_as_restrictive(&base, &open_feed));
        assert!(!is_at_least_as_restrictive(&base, &judged_feed));
        assert!(is_at_least_as_restrictive(&judged_feed, &base));
        assert!(is_at_least_as_restrictive(&base, &blocked_content));
        assert!(!is_at_least_as_restrictive(&blocked_content, &base));
        // Locked features can't be loosened by an override.
        let essentials = with_site(policy(&[], &[], RuleAction::Allow), "youtube", &[("essentials", RuleAction::Block)]);
        assert!(is_at_least_as_restrictive(&essentials, &base));
    }

    #[test]
    fn weakening_the_default_or_dropping_the_judge_is_a_relaxation() {
        let judge = crate::policy::JudgePolicy {
            tasks: vec![crate::policy::JudgeTask { id: "a".into(), title: "thesis".into(), notes: None }],
            avoid: vec![],
            fallback: DefaultAction::Allow,
        };
        let mut judged = policy(&[], &[], RuleAction::Judge);
        judged.judge = Some(judge.clone());
        assert!(!is_at_least_as_restrictive(&judged, &policy(&[], &[], RuleAction::Allow)));
        assert!(is_at_least_as_restrictive(&policy(&[], &[], RuleAction::Allow), &judged));
        assert!(!is_at_least_as_restrictive(&policy(&[], &[], RuleAction::Block), &judged));
        let mut dropped = judged.clone();
        dropped.judge = None;
        assert!(!is_at_least_as_restrictive(&judged, &dropped));
        // Editing tasks mid-session is allowed.
        let mut edited = judged.clone();
        edited.judge.as_mut().unwrap().tasks[0].title = "chapter two".into();
        assert!(is_at_least_as_restrictive(&judged, &edited));
    }

    use crate::policy::PremadeListId;

    #[test]
    fn enabling_a_premade_list_blocks_its_domains() {
        let p = policy(&[], &[], RuleAction::Allow);
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
        let mut p = policy(&[], &["amazon.com"], RuleAction::Allow);
        p.enabled_premade_lists = vec![PremadeListId::Shopping];
        assert!(!is_host_blocked(&p, "amazon.com"));
        // Other shopping domains stay blocked.
        assert!(is_host_blocked(&p, "ebay.com"));
    }

    #[test]
    fn enabling_a_premade_list_is_more_restrictive_and_disabling_one_is_a_relaxation() {
        let mut off = policy(&[], &[], RuleAction::Allow);
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
        let mut prev = policy(&[], &[], RuleAction::Allow);
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
        let p = policy(&["reddit.com"], &["docs.reddit.com"], RuleAction::Allow);
        assert!(is_host_blocked(&p, "reddit.com"));
        // Block wins when a host matches both lists — the normalizer is expected to prevent this,
        // but enforcement must fail safe if it ever slips through.
        assert!(is_host_blocked(&p, "docs.reddit.com"));
        assert!(!is_host_blocked(&p, "example.com"));
    }

    #[test]
    fn default_action_governs_hosts_on_neither_list() {
        let open = policy(&[], &[], RuleAction::Allow);
        assert!(!is_host_blocked(&open, "example.com"));

        let closed = policy(&[], &["docs.rs"], RuleAction::Block);
        assert!(is_host_blocked(&closed, "example.com"));
        assert!(!is_host_blocked(&closed, "docs.rs"));
        assert!(!is_host_blocked(&closed, "sub.docs.rs"));
    }

    /// `defaultAction: judge` must not sinkhole unlisted hosts at the DNS layer — that would
    /// stop the page from ever loading, so the extension's `judgeRequest` (which is what's
    /// actually supposed to decide unlisted hosts) never runs.
    #[test]
    fn a_judged_default_lets_unlisted_hosts_through() {
        let mut smart = policy(&[], &[], RuleAction::Judge);
        assert!(!is_host_blocked(&smart, "example.com"));
        // Hard lists still win under a judged default.
        smart.blocked_domains = vec!["evil.com".into()];
        assert!(is_host_blocked(&smart, "evil.com"));
    }

    #[test]
    fn adding_a_blocked_domain_is_more_restrictive() {
        let prev = policy(&["reddit.com"], &[], RuleAction::Allow);
        let next = policy(&["reddit.com", "x.com"], &[], RuleAction::Allow);
        assert!(is_at_least_as_restrictive(&prev, &next));
        assert!(!is_at_least_as_restrictive(&next, &prev));
    }

    #[test]
    fn switching_the_default_to_block_is_more_restrictive() {
        let open = policy(&[], &[], RuleAction::Allow);
        let closed = policy(&[], &[], RuleAction::Block);
        assert!(is_at_least_as_restrictive(&open, &closed));
        assert!(!is_at_least_as_restrictive(&closed, &open));
    }

    /// Widening an allow list under a block-by-default policy frees traffic, so it must be
    /// treated as a relaxation and require the key.
    #[test]
    fn widening_an_allow_list_is_a_relaxation() {
        let prev = policy(&[], &["docs.rs"], RuleAction::Block);
        let next = policy(&[], &["docs.rs", "reddit.com"], RuleAction::Block);
        assert!(!is_at_least_as_restrictive(&prev, &next));
        assert!(is_at_least_as_restrictive(&next, &prev));
    }

    #[test]
    fn an_identical_policy_is_at_least_as_restrictive() {
        let p = policy(&["reddit.com"], &["docs.rs"], RuleAction::Block);
        assert!(is_at_least_as_restrictive(&p, &p));
    }

    #[test]
    fn dropping_a_blocked_app_is_a_relaxation() {
        let app = |name: &str| AppRef {
            windows_image_name: Some(name.into()),
            linux_process_name: None,
            mac_bundle_id: None,
            android_package: None,
            label: name.into(),
        };
        let mut prev = policy(&[], &[], RuleAction::Allow);
        prev.apps = vec![app("chrome.exe")];
        let next = policy(&[], &[], RuleAction::Allow);
        assert!(!is_at_least_as_restrictive(&prev, &next));
        assert!(is_at_least_as_restrictive(&next, &prev));
    }

    /// `.exe` is stripped when comparing, so the same app authored from different platforms is
    /// recognized as the same executable and does not read as a relaxation.
    #[test]
    fn app_identity_ignores_the_exe_suffix_and_label() {
        let mut prev = policy(&[], &[], RuleAction::Allow);
        prev.apps = vec![AppRef {
            windows_image_name: Some("Chrome.exe".into()),
            linux_process_name: None,
            mac_bundle_id: None,
            android_package: None,
            label: "Chrome".into(),
        }];
        let mut next = policy(&[], &[], RuleAction::Allow);
        next.apps = vec![AppRef {
            windows_image_name: Some("chrome".into()),
            linux_process_name: None,
            mac_bundle_id: None,
            android_package: None,
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
