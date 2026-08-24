//! Pure domain/app matching used by the DNS sinkhole and the app blocker. Mirrors the intent
//! of packages/core/src/policyNormalize.ts matching (wildcards are a leading "*.").

use crate::model::{AppRef, DefaultAction, Policy};

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
/// `defaultAction`, UNLESS `intent` is set, in which case unlisted hosts are let through so the
/// page can load and the browser extension's `judgeRequest` gets a chance to run. `defaultAction`
/// still applies in that case — just as the fail-closed/fail-open fallback if the judge never
/// answers, not as a live gate here.
pub fn is_host_blocked(policy: &Policy, host: &str) -> bool {
    if policy.blocked_domains.iter().any(|p| host_matches(host, p)) {
        return true;
    }
    if policy.allowed_domains.iter().any(|p| host_matches(host, p)) {
        return false;
    }
    if policy.intent.is_some() {
        // Smart filtering judges unlisted hosts at the page level (judgeRequest), which requires
        // the page to actually load. The DNS/nftables layer must not preempt that by sinkholing
        // on `defaultAction` here — `defaultAction` still applies as the fail-closed/fail-open
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
/// (unblocking a site or app, or a mode change that frees traffic) returns false.
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

/// Hostnames a future DNS sinkhole should refuse while focus is active, independent of the user's
/// policy, because they exist to bypass local DNS filtering.
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

/// Image names whose live TCP connections we reset on a focus/policy change, so a newly-blocked
/// site dies immediately instead of riding an already-open socket (enforce::divert). Browsers
/// are the case that matters; blocked apps are reset separately via `is_app_blocked`.
pub const BROWSER_IMAGE_NAMES: &[&str] = &[
    "firefox",
    "chrome",
    "google-chrome",
    "brave",
    "brave-browser",
    "chromium",
    "chromium-browser",
    "vivaldi",
    "opera",
    "librewolf",
    "waterfox",
    "tor",
    "tor-browser",
    "floorp",
    "thorium",
];

/// Case-insensitive match of a process image name against the known browser list.
pub fn is_browser_image(image_name: &str) -> bool {
    BROWSER_IMAGE_NAMES
        .iter()
        .any(|b| b.eq_ignore_ascii_case(image_name))
}

/// Does a running process image name (e.g. "chrome") match a blocked app?
pub fn is_app_blocked(policy: &Policy, image_name: &str) -> bool {
    let name = image_name.to_ascii_lowercase();
    policy.apps.iter().any(|a| {
        a.linux_process_name
            .as_deref()
            .map(|n| n.eq_ignore_ascii_case(&name))
            .or_else(|| {
                a.windows_image_name
                    .as_deref()
                    .map(|n| n.trim_end_matches(".exe").eq_ignore_ascii_case(&name))
            })
            .unwrap_or(false)
    })
}

#[cfg(test)]
mod restrictiveness_tests {
    use super::*;
    use crate::model::{AppRef, DefaultAction, Policy};

    /// Old "blacklist" preset: open by default, block only the listed domains.
    fn blacklist(list: &[&str]) -> Policy {
        Policy {
            blocked_domains: list.iter().map(|s| (*s).into()).collect(),
            allowed_domains: vec![],
            default_action: DefaultAction::Allow,
            intent: None,
            apps: vec![],
        }
    }

    /// Old "whitelist" preset: blocked by default, allow only the listed domains.
    fn whitelist(list: &[&str]) -> Policy {
        Policy {
            blocked_domains: vec![],
            allowed_domains: list.iter().map(|s| (*s).into()).collect(),
            default_action: DefaultAction::Block,
            intent: None,
            apps: vec![],
        }
    }

    /// Old "block-all" preset: blocked by default, nothing on either hard list.
    fn block_all() -> Policy {
        Policy {
            blocked_domains: vec![],
            allowed_domains: vec![],
            default_action: DefaultAction::Block,
            intent: None,
            apps: vec![],
        }
    }

    fn app(name: &str) -> AppRef {
        AppRef {
            windows_image_name: Some(format!("{name}.exe")),
            linux_process_name: Some(name.into()),
            mac_bundle_id: None,
            label: name.into(),
        }
    }

    #[test]
    fn identical_is_allowed() {
        let p = blacklist(&["youtube.com", "reddit.com"]);
        assert!(is_at_least_as_restrictive(&p, &p.clone()));
    }

    #[test]
    fn blacklist_add_is_free_remove_is_gated() {
        let prev = blacklist(&["youtube.com"]);
        let added = blacklist(&["youtube.com", "reddit.com"]);
        let removed = blacklist(&[]);
        assert!(is_at_least_as_restrictive(&prev, &added));
        assert!(!is_at_least_as_restrictive(&prev, &removed));
    }

    #[test]
    fn blacklist_narrowing_wildcard_is_gated() {
        // *.reddit.com blocks every subdomain; old.reddit.com frees www.reddit.com etc.
        let prev = blacklist(&["*.reddit.com"]);
        let next = blacklist(&["old.reddit.com"]);
        assert!(!is_at_least_as_restrictive(&prev, &next));
    }

    #[test]
    fn whitelist_add_is_permissive_remove_is_restrictive() {
        // Whitelist: listed hosts are the *only* allowed ones. Adding an entry frees traffic.
        let prev = whitelist(&["work.com"]);
        let widened = whitelist(&["work.com", "fun.com"]);
        let narrowed = whitelist(&[]);
        assert!(!is_at_least_as_restrictive(&prev, &widened));
        assert!(is_at_least_as_restrictive(&prev, &narrowed));
    }

    #[test]
    fn block_all_is_the_ceiling() {
        let all = block_all();
        let bl = blacklist(&["youtube.com"]);
        // Anything -> block-all only tightens; block-all -> anything looser is gated.
        assert!(is_at_least_as_restrictive(&bl, &all));
        assert!(!is_at_least_as_restrictive(&all, &bl));
    }

    #[test]
    fn removing_a_blocked_app_is_gated() {
        let prev = Policy {
            apps: vec![app("chrome"), app("slack")],
            ..Policy::default()
        };
        let kept = Policy {
            apps: vec![app("chrome"), app("slack"), app("discord")],
            ..Policy::default()
        };
        let removed = Policy {
            apps: vec![app("chrome")],
            ..Policy::default()
        };
        assert!(is_at_least_as_restrictive(&prev, &kept));
        assert!(!is_at_least_as_restrictive(&prev, &removed));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{AppRef, DefaultAction};

    #[test]
    fn wildcard_matches_subdomains() {
        assert!(host_matches("www.reddit.com", "*.reddit.com"));
        assert!(host_matches("reddit.com", "*.reddit.com"));
        assert!(!host_matches("notreddit.com", "*.reddit.com"));
    }

    #[test]
    fn exact_matches_subdomains_too() {
        assert!(host_matches("m.youtube.com", "youtube.com"));
        assert!(host_matches("youtube.com", "youtube.com"));
    }

    #[test]
    fn blocked_and_allowed_lists_win_over_the_default() {
        let mut p = Policy::default();
        p.blocked_domains = vec!["youtube.com".into()];
        p.default_action = DefaultAction::Allow;
        assert!(is_host_blocked(&p, "youtube.com"));
        assert!(!is_host_blocked(&p, "example.com"));

        let mut p = Policy::default();
        p.allowed_domains = vec!["youtube.com".into()];
        p.default_action = DefaultAction::Block;
        assert!(!is_host_blocked(&p, "youtube.com"));
        assert!(is_host_blocked(&p, "example.com"));

        let mut p = Policy::default();
        p.default_action = DefaultAction::Block;
        assert!(is_host_blocked(&p, "youtube.com"));
    }

    #[test]
    fn blocked_domains_win_when_a_host_is_on_both_lists() {
        let mut p = Policy::default();
        p.blocked_domains = vec!["youtube.com".into()];
        p.allowed_domains = vec!["youtube.com".into()];
        p.default_action = DefaultAction::Allow;
        assert!(is_host_blocked(&p, "youtube.com"));
    }

    #[test]
    fn doh_bypass_hosts() {
        assert!(is_doh_bypass_host("use-application-dns.net"));
        assert!(is_doh_bypass_host("dns.google"));
        assert!(is_doh_bypass_host("mozilla.cloudflare-dns.com"));
        assert!(is_doh_bypass_host("dns.adguard-dns.com"));
        assert!(!is_doh_bypass_host("google.com"));
        assert!(!is_doh_bypass_host("example.com"));
    }

    #[test]
    fn browser_match() {
        assert!(is_browser_image("firefox"));
        assert!(is_browser_image("Chrome"));
        assert!(is_browser_image("google-chrome"));
        assert!(!is_browser_image("spotify"));
        assert!(!is_browser_image("explorer"));
    }

    #[test]
    fn app_match() {
        let mut p = Policy::default();
        p.apps = vec![AppRef {
            windows_image_name: Some("chrome.exe".into()),
            linux_process_name: Some("chrome".into()),
            mac_bundle_id: None,
            label: "Chrome".into(),
        }];
        assert!(is_app_blocked(&p, "Chrome"));
        assert!(!is_app_blocked(&p, "firefox"));
    }
}
