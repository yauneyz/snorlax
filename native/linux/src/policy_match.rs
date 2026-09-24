//! Linux-specific policy matching. The schema-dependent domain matching lives in
//! `talysman_common::policy_match` so all three backends share one definition; this module
//! re-exports it and adds the parts that are genuinely platform-specific — the browser process
//! table and app matching, which key off process names.

pub use talysman_common::policy_match::{
    effective_dns_sinkhole_domains, host_matches, is_at_least_as_restrictive, is_doh_bypass_host,
    is_host_blocked, DOH_BYPASS_HOSTS,
};

use crate::model::Policy;

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
    use crate::model::{AppRef, RuleAction, Policy};

    /// Old "blacklist" preset: open by default, block only the listed domains.
    fn blacklist(list: &[&str]) -> Policy {
        Policy {
            blocked_domains: list.iter().map(|s| (*s).into()).collect(),
            allowed_domains: vec![],
            default_action: RuleAction::Allow,
            judge: None,
            apps: vec![],
            enabled_premade_lists: vec![],
            sites: Default::default(),
        }
    }

    /// Old "whitelist" preset: blocked by default, allow only the listed domains.
    fn whitelist(list: &[&str]) -> Policy {
        Policy {
            blocked_domains: vec![],
            allowed_domains: list.iter().map(|s| (*s).into()).collect(),
            default_action: RuleAction::Block,
            judge: None,
            apps: vec![],
            enabled_premade_lists: vec![],
            sites: Default::default(),
        }
    }

    /// Old "block-all" preset: blocked by default, nothing on either hard list.
    fn block_all() -> Policy {
        Policy {
            blocked_domains: vec![],
            allowed_domains: vec![],
            default_action: RuleAction::Block,
            judge: None,
            apps: vec![],
            enabled_premade_lists: vec![],
            sites: Default::default(),
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
    use crate::model::{AppRef, RuleAction};

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
        p.default_action = RuleAction::Allow;
        assert!(is_host_blocked(&p, "youtube.com"));
        assert!(!is_host_blocked(&p, "example.com"));

        let mut p = Policy::default();
        p.allowed_domains = vec!["youtube.com".into()];
        p.default_action = RuleAction::Block;
        assert!(!is_host_blocked(&p, "youtube.com"));
        assert!(is_host_blocked(&p, "example.com"));

        let mut p = Policy::default();
        p.default_action = RuleAction::Block;
        assert!(is_host_blocked(&p, "youtube.com"));
    }

    #[test]
    fn blocked_domains_win_when_a_host_is_on_both_lists() {
        let mut p = Policy::default();
        p.blocked_domains = vec!["youtube.com".into()];
        p.allowed_domains = vec!["youtube.com".into()];
        p.default_action = RuleAction::Allow;
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
