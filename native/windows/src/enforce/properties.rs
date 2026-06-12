//! Curated "multi-domain property" groups (closes the CDN-sibling leak documented in
//! `limitation.md`). A site like Reddit serves its content from sibling domains
//! (`redditmedia.com`, `redditstatic.com`, …) whose names don't literally match `reddit.com`,
//! so blocking only `reddit.com` lets those siblings resolve and serve content — and gives the
//! browser an allowed socket that HTTP/2 coalescing can reuse for `reddit.com` itself.
//!
//! This table maps a canonical domain to its sibling domains. `expand_domains` adds the siblings
//! of any listed canonical to the *enforced* domain set (see `EnforceShared::set_policy`). It is
//! deliberately NOT applied to the user's authored/persisted policy — the user's list stays
//! their clean input; the expansion is an enforcement detail that ships (and updates) with the
//! binary. The same expansion benefits whitelist mode (allowing `youtube.com` also allows
//! `googlevideo.com`, so video plays) since it only ever adds siblings of listed domains.

use std::collections::HashSet;

/// `(canonical, &[siblings])`. Keep entries lowercase and bare (no `*.`); matching is
/// case-insensitive and already covers subdomains via `policy_match::host_matches`.
pub const PROPERTY_GROUPS: &[(&str, &[&str])] = &[
    (
        "reddit.com",
        &["redditstatic.com", "redditmedia.com", "redditspace.com", "redd.it"],
    ),
    (
        "youtube.com",
        &["googlevideo.com", "ytimg.com", "youtube-nocookie.com", "youtu.be"],
    ),
    ("x.com", &["twimg.com", "twitter.com", "t.co"]),
    ("twitter.com", &["twimg.com", "x.com", "t.co"]),
    ("instagram.com", &["cdninstagram.com", "fbcdn.net"]),
    ("facebook.com", &["fbcdn.net", "facebook.net", "fb.com"]),
    ("tiktok.com", &["tiktokcdn.com", "tiktokv.com", "ibytedtos.com", "byteoversea.com"]),
    ("netflix.com", &["nflxvideo.net", "nflximg.net", "nflxext.com"]),
    ("twitch.tv", &["ttvnw.net", "jtvnw.net"]),
    ("discord.com", &["discordapp.com", "discordapp.net", "discord.gg"]),
    ("pinterest.com", &["pinimg.com"]),
    ("linkedin.com", &["licdn.com"]),
];

/// Return the siblings for a canonical domain, if it is a known multi-domain property.
pub fn siblings_for(canonical: &str) -> Option<&'static [&'static str]> {
    PROPERTY_GROUPS
        .iter()
        .find(|(c, _)| c.eq_ignore_ascii_case(canonical))
        .map(|(_, sibs)| *sibs)
}

/// Expand an authored domain list into the set the service actually enforces: every authored
/// entry plus, for any entry that is a known property canonical, that property's siblings.
/// Order-stable and de-duplicated (case-insensitively). A leading `*.` wildcard on an authored
/// entry is honored when matching it against the canonical table.
pub fn expand_domains(domains: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(domains.len());
    let mut seen: HashSet<String> = HashSet::new();
    for d in domains {
        let trimmed = d.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.to_ascii_lowercase()) {
            out.push(trimmed.to_string());
        }
        let key = trimmed.trim_start_matches("*.").to_ascii_lowercase();
        if let Some(sibs) = siblings_for(&key) {
            for s in sibs {
                if seen.insert(s.to_ascii_lowercase()) {
                    out.push((*s).to_string());
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_known_property() {
        let got = expand_domains(&["reddit.com".to_string()]);
        assert!(got.contains(&"reddit.com".to_string()));
        assert!(got.contains(&"redditmedia.com".to_string()));
        assert!(got.contains(&"redditstatic.com".to_string()));
    }

    #[test]
    fn honors_wildcard_prefix_when_matching_canonical() {
        let got = expand_domains(&["*.youtube.com".to_string()]);
        assert!(got.contains(&"*.youtube.com".to_string()));
        assert!(got.contains(&"googlevideo.com".to_string()));
    }

    #[test]
    fn passthrough_for_unknown_domain() {
        let got = expand_domains(&["example.com".to_string()]);
        assert_eq!(got, vec!["example.com".to_string()]);
    }

    #[test]
    fn dedups_case_insensitively_and_keeps_order() {
        let got = expand_domains(&[
            "Reddit.com".to_string(),
            "redditmedia.com".to_string(), // already pulled in as a sibling
            "example.com".to_string(),
        ]);
        assert_eq!(got[0], "Reddit.com");
        // redditmedia.com appears once, not duplicated by the explicit entry.
        assert_eq!(got.iter().filter(|d| d.eq_ignore_ascii_case("redditmedia.com")).count(), 1);
        assert!(got.contains(&"example.com".to_string()));
    }

    #[test]
    fn empty_entries_skipped() {
        let got = expand_domains(&["".to_string(), "  ".to_string()]);
        assert!(got.is_empty());
    }
}
