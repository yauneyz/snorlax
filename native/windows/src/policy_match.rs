//! Windows-specific policy matching. The schema-dependent domain matching lives in
//! `talysman_common::policy_match` so all three backends share one definition; this module
//! re-exports it and adds the parts that are genuinely Windows-specific — the browser image-name
//! table and app matching, which key off `.exe` names.

pub use talysman_common::policy_match::{
    host_matches, is_at_least_as_restrictive, is_doh_bypass_host, is_host_blocked,
    DOH_BYPASS_HOSTS,
};

use crate::model::Policy;

/// Image names whose live TCP connections we reset on a focus/policy change, so a newly-blocked
/// site dies immediately instead of riding an already-open socket (enforce::divert). Browsers
/// are the case that matters; blocked apps are reset separately via `is_app_blocked`.
pub const BROWSER_IMAGE_NAMES: &[&str] = &[
    "firefox.exe",
    "chrome.exe",
    "msedge.exe",
    "brave.exe",
    "opera.exe",
    "opera_gx.exe",
    "vivaldi.exe",
    "arc.exe",
    "iexplore.exe",
    "chromium.exe",
    "librewolf.exe",
    "waterfox.exe",
    "tor.exe",
    "floorp.exe",
    "thorium.exe",
];

/// Case-insensitive match of a process image name against the known browser list.
pub fn is_browser_image(image_name: &str) -> bool {
    BROWSER_IMAGE_NAMES
        .iter()
        .any(|b| b.eq_ignore_ascii_case(image_name))
}

/// Does a running process image name (e.g. "chrome.exe") match a blocked app?
pub fn is_app_blocked(policy: &Policy, image_name: &str) -> bool {
    let name = image_name.to_ascii_lowercase();
    policy.apps.iter().any(|a| {
        a.windows_image_name
            .as_deref()
            .map(|n| n.eq_ignore_ascii_case(&name))
            .unwrap_or(false)
    })
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

    /// The three legacy presets, expressed in the current schema, still classify the same way.
    /// This is the Windows-side guard on the migration that replaced `mode` with independent
    /// hard lists plus `defaultAction`.
    #[test]
    fn preset_equivalents_of_the_old_modes() {
        // blacklist: block the listed domain, allow everything else.
        let mut p = Policy {
            blocked_domains: vec!["youtube.com".into()],
            ..Policy::default()
        };
        assert!(is_host_blocked(&p, "youtube.com"));
        assert!(!is_host_blocked(&p, "example.com"));

        // whitelist: allow only the listed domain, block everything else.
        p = Policy {
            allowed_domains: vec!["youtube.com".into()],
            default_action: DefaultAction::Block,
            ..Policy::default()
        };
        assert!(!is_host_blocked(&p, "youtube.com"));
        assert!(is_host_blocked(&p, "example.com"));

        // block-all: nothing on either list, block by default.
        p = Policy {
            default_action: DefaultAction::Block,
            ..Policy::default()
        };
        assert!(is_host_blocked(&p, "youtube.com"));
        assert!(is_host_blocked(&p, "example.com"));
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
        assert!(is_browser_image("firefox.exe"));
        assert!(is_browser_image("Chrome.exe"));
        assert!(is_browser_image("MSEDGE.EXE"));
        assert!(!is_browser_image("spotify.exe"));
        assert!(!is_browser_image("explorer.exe"));
    }

    #[test]
    fn app_match() {
        let p = Policy {
            apps: vec![AppRef {
                windows_image_name: Some("chrome.exe".into()),
                linux_process_name: None,
                mac_bundle_id: None,
                label: "Chrome".into(),
            }],
            ..Policy::default()
        };
        assert!(is_app_blocked(&p, "Chrome.exe"));
        assert!(!is_app_blocked(&p, "firefox.exe"));
    }
}
