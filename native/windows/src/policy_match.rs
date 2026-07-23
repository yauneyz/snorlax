//! Pure domain/app matching used by the DNS sinkhole and the app blocker. Mirrors the intent
//! of packages/core/src/policyNormalize.ts matching (wildcards are a leading "*.").

use crate::model::{AppRef, Mode, Policy};

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
    for pattern in prev.domains.iter().chain(next.domains.iter()) {
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

    prev
        .apps
        .iter()
        .all(|app| next.apps.iter().any(|candidate| same_app(candidate, app)))
}

/// Hostnames the sinkhole always refuses while focus is active, independent of the user's
/// policy, because they exist to *bypass* the sinkhole: DoH resolver endpoints (a browser must
/// resolve the endpoint hostname before it can speak DoH — hardcoded-IP endpoints are handled
/// by the firewall blocklist in enforce::wfp instead) plus the Firefox canary domain, whose
/// NXDOMAIN tells Firefox to keep auto-DoH off. Non-wildcard entries match subdomains too
/// (host_matches), so "cloudflare-dns.com" covers mozilla.cloudflare-dns.com etc.
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
        let mut p = Policy::default();
        p.apps = vec![AppRef {
            windows_image_name: Some("chrome.exe".into()),
            linux_process_name: None,
            mac_bundle_id: None,
            label: "Chrome".into(),
        }];
        assert!(is_app_blocked(&p, "Chrome.exe"));
        assert!(!is_app_blocked(&p, "firefox.exe"));
    }
}
