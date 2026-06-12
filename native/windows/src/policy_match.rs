//! Pure domain/app matching used by the DNS sinkhole and the app blocker. Mirrors the intent
//! of packages/core/src/policyNormalize.ts matching (wildcards are a leading "*.").

use crate::model::{Mode, Policy};

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

/// Should a DNS query for `host` be blocked under `policy`?
pub fn is_host_blocked(policy: &Policy, host: &str) -> bool {
    let listed = policy.domains.iter().any(|p| host_matches(host, p));
    match policy.mode {
        Mode::Blacklist => listed,
        Mode::Whitelist => !listed,
        Mode::BlockAll => true,
    }
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
    use crate::model::AppRef;

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
    fn modes() {
        let mut p = Policy::default();
        p.domains = vec!["youtube.com".into()];
        p.mode = Mode::Blacklist;
        assert!(is_host_blocked(&p, "youtube.com"));
        assert!(!is_host_blocked(&p, "example.com"));
        p.mode = Mode::Whitelist;
        assert!(!is_host_blocked(&p, "youtube.com"));
        assert!(is_host_blocked(&p, "example.com"));
        p.mode = Mode::BlockAll;
        assert!(is_host_blocked(&p, "youtube.com"));
    }

    #[test]
    fn app_match() {
        let mut p = Policy::default();
        p.apps = vec![AppRef {
            windows_image_name: Some("chrome.exe".into()),
            mac_bundle_id: None,
            label: "Chrome".into(),
        }];
        assert!(is_app_blocked(&p, "Chrome.exe"));
        assert!(!is_app_blocked(&p, "firefox.exe"));
    }
}
