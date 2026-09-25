//! The site catalog, as the engine sees it: which hosts each supported site owns, which asset
//! domains its pages need, its feature schema (ids, defaults, locked flags), its routes, and its
//! Android packages.
//!
//! The catalog is authored once in `packages/shared/src/sites` and generated into
//! `resources/site-catalog.json` by `pnpm generate:sites`; this module embeds that file. Page-level
//! element hiding stays the extension's job; the engine classifies URLs only for browsers that
//! can't run the extension (Android Chrome), where a page whose own feature is blocked is blocked
//! outright ([`CatalogSite::classify`], kept in lockstep with `classifyUrl` in
//! apps/extension/src/site-engine.js by the catalog's own `examples`).

use std::collections::BTreeMap;
use std::sync::OnceLock;

use regex_lite::Regex;
use serde::Deserialize;

use crate::policy::{RuleAction, SiteRule};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogFeature {
    pub id: String,
    #[serde(default)]
    pub label: String,
    pub default: RuleAction,
    pub locked: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRoute {
    pub feature: String,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub query: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSite {
    pub id: String,
    #[serde(default)]
    pub label: String,
    /// Registrable domains whose pages the site owns (subdomains included).
    pub hosts: Vec<String>,
    /// Exact hostnames that serve the site's app; other subdomains classify as the fallback.
    #[serde(default)]
    pub app_hosts: Vec<String>,
    /// Asset/CDN domains the site's pages need.
    pub network_domains: Vec<String>,
    pub features: Vec<CatalogFeature>,
    #[serde(default)]
    pub routes: Vec<CatalogRoute>,
    #[serde(default)]
    pub fallback_feature: String,
    /// Android application ids driven by the same site rule.
    #[serde(default)]
    pub android_packages: Vec<String>,
    /// `[url, feature]` fixtures shared with the extension's tests.
    #[serde(default)]
    pub examples: Vec<(String, String)>,
}

#[derive(Deserialize)]
struct CatalogFile {
    sites: Vec<CatalogSite>,
}

static CATALOG: OnceLock<Vec<CatalogSite>> = OnceLock::new();

/// Every catalog site, in catalog order.
pub fn sites() -> &'static [CatalogSite] {
    CATALOG.get_or_init(|| {
        serde_json::from_str::<CatalogFile>(include_str!("../resources/site-catalog.json"))
            .expect("embedded site-catalog.json is generated and validated at build time")
            .sites
    })
}

pub fn site(id: &str) -> Option<&'static CatalogSite> {
    sites().iter().find(|site| site.id == id)
}

fn host_under(host: &str, domain: &str) -> bool {
    host == domain || host.strip_suffix(domain).is_some_and(|prefix| prefix.ends_with('.'))
}

/// The catalog site owning `host` (the site's own hosts, not its asset domains).
pub fn site_for_host(host: &str) -> Option<&'static CatalogSite> {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    sites().iter().find(|site| site.hosts.iter().any(|domain| host_under(&host, domain)))
}

/// The catalog site owning an Android package.
pub fn site_for_package(package: &str) -> Option<&'static CatalogSite> {
    sites().iter().find(|site| site.android_packages.iter().any(|p| p == package))
}

/// Where a URL lands in the catalog.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Classification {
    pub site: &'static str,
    pub feature: String,
    /// Index of the matching route, or -1 for the fallback.
    pub route: i32,
}

/// The parts of an http(s) URL that routing looks at.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedUrl {
    pub host: String,
    /// Raw pathname ("/" when empty).
    pub path: String,
    /// Raw query string without the leading `?`.
    pub query: String,
}

/// Minimal WHATWG-compatible split of an http(s) URL. Returns None for other schemes. A bare
/// "host/path" (as Android URL bars often show it) is treated as https.
pub fn parse_url(value: &str) -> Option<ParsedUrl> {
    let value = value.trim();
    let rest = match value.split_once("://") {
        Some((scheme, rest)) => {
            let scheme = scheme.to_ascii_lowercase();
            if scheme != "http" && scheme != "https" {
                return None;
            }
            rest
        }
        None => {
            if value.contains(':') && !value.split('/').next().unwrap_or("").contains('.') {
                return None;
            }
            value
        }
    };
    let rest = rest.split('#').next().unwrap_or("");
    let authority_end = rest.find(['/', '?']).unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    let tail = &rest[authority_end..];
    let host_port = authority.rsplit('@').next().unwrap_or("");
    let host = if host_port.starts_with('[') {
        host_port.split(']').next().map(|h| format!("{h}]")).unwrap_or_default()
    } else {
        host_port.split(':').next().unwrap_or("").to_string()
    };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() {
        return None;
    }
    let (path, query) = match tail.split_once('?') {
        Some((path, query)) => (path, query),
        None => (tail, ""),
    };
    let path = if path.is_empty() { "/".to_string() } else { path.to_string() };
    Some(ParsedUrl { host, path, query: query.to_string() })
}

/// First value per key, still percent-encoded (mirrors `rawQuery` in site-engine.js).
fn raw_query(query: &str) -> BTreeMap<&str, &str> {
    let mut out = BTreeMap::new();
    for part in query.split('&').filter(|p| !p.is_empty()) {
        let (key, value) = part.split_once('=').unwrap_or((part, ""));
        out.entry(key).or_insert(value);
    }
    out
}

fn regex(source: &str) -> Option<Regex> {
    static CACHE: OnceLock<std::sync::Mutex<BTreeMap<String, Option<Regex>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    let mut guard = cache.lock().unwrap_or_else(|e| e.into_inner());
    guard
        .entry(source.to_string())
        .or_insert_with(|| Regex::new(source).ok())
        .clone()
}

/// Map a URL onto its catalog site and feature. None for URLs no catalog site owns.
pub fn classify_url(url: &str) -> Option<Classification> {
    let parsed = parse_url(url)?;
    let site = site_for_host(&parsed.host)?;
    Some(site.classify(&parsed))
}

impl CatalogSite {
    /// Every domain the site's pages and assets load from.
    pub fn all_domains(&self) -> impl Iterator<Item = &str> {
        self.hosts.iter().chain(self.network_domains.iter()).map(String::as_str)
    }

    pub fn owns_host(&self, host: &str) -> bool {
        let host = host.trim_end_matches('.').to_ascii_lowercase();
        self.hosts.iter().any(|domain| host_under(&host, domain))
    }

    pub fn feature(&self, id: &str) -> Option<&CatalogFeature> {
        self.features.iter().find(|feature| feature.id == id)
    }

    /// Route classification. Mirrors `classifyUrl` in apps/extension/src/site-engine.js: the
    /// lowercased path with trailing slashes trimmed, first matching route wins, hosts that aren't
    /// app hosts and unmatched URLs fall back to `fallback_feature`.
    pub fn classify(&'static self, url: &ParsedUrl) -> Classification {
        let fallback = Classification { site: &self.id, feature: self.fallback_feature.clone(), route: -1 };
        if !self.app_hosts.iter().any(|h| *h == url.host) {
            return fallback;
        }
        let lowered = url.path.to_lowercase();
        let trimmed = lowered.trim_end_matches('/');
        let path = if trimmed.is_empty() { "/" } else { trimmed };
        let query = raw_query(&url.query);
        for (index, route) in self.routes.iter().enumerate() {
            if route.host.as_deref().is_some_and(|h| h != url.host) {
                continue;
            }
            if let Some(pattern) = &route.path {
                if !regex(pattern).is_some_and(|re| re.is_match(path)) {
                    continue;
                }
            }
            let query_ok = route.query.iter().all(|(key, pattern)| {
                query
                    .get(key.as_str())
                    .is_some_and(|value| regex(pattern).is_some_and(|re| re.is_match(value)))
            });
            if !query_ok {
                continue;
            }
            return Classification { site: &self.id, feature: route.feature.clone(), route: index as i32 };
        }
        fallback
    }

    /// The action for every feature: the user's overrides over catalog defaults, with locked
    /// features and unknown/unset overrides falling back to the default. Mirrors
    /// `effectiveFeatures` in apps/extension/src/site-engine.js.
    pub fn effective(&self, rule: Option<&SiteRule>) -> BTreeMap<String, RuleAction> {
        self.features
            .iter()
            .map(|feature| {
                let action = match rule.and_then(|rule| rule.features.get(&feature.id)) {
                    Some(action) if !feature.locked => *action,
                    _ => feature.default,
                };
                (feature.id.clone(), action)
            })
            .collect()
    }

    /// Does `next` restrict every feature at least as much as `prev` (block > judge > allow)?
    pub fn at_least_as_restrictive(&self, prev: Option<&SiteRule>, next: Option<&SiteRule>) -> bool {
        let after = self.effective(next);
        self.effective(prev)
            .iter()
            .all(|(feature, action)| after.get(feature).map_or(false, |next| next.rank() >= action.rank()))
    }

    /// Is some feature stricter than the catalog default?
    pub fn stricter_than_defaults(&self, rule: Option<&SiteRule>) -> bool {
        !self.at_least_as_restrictive(rule, None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_catalog_parses_and_has_unique_ids() {
        let ids: Vec<&str> = sites().iter().map(|site| site.id.as_str()).collect();
        let mut sorted = ids.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), ids.len());
        assert!(site("reddit").is_some());
        assert!(site("nope").is_none());
    }

    /// The same fixtures the extension's catalog test runs through `classifyUrl`.
    #[test]
    fn every_catalog_example_classifies_like_the_extension() {
        // App-only entries (no website) have nothing to classify.
        for site in sites().iter().filter(|site| !site.hosts.is_empty()) {
            assert!(!site.examples.is_empty(), "{} has no examples", site.id);
            for (url, feature) in &site.examples {
                let got = classify_url(url).unwrap_or_else(|| panic!("{url} is not classified"));
                assert_eq!(got.site, site.id, "{url}");
                assert_eq!(&got.feature, feature, "{url}");
            }
        }
    }

    #[test]
    fn url_parsing_handles_ports_userinfo_fragments_and_bare_hosts() {
        let u = parse_url("https://user@WWW.YouTube.com:443/Shorts/abc/?x=1#frag").unwrap();
        assert_eq!(u.host, "www.youtube.com");
        assert_eq!(u.path, "/Shorts/abc/");
        assert_eq!(u.query, "x=1");
        assert_eq!(parse_url("m.youtube.com/watch?v=1").unwrap().host, "m.youtube.com");
        assert!(parse_url("chrome://settings").is_none());
        assert!(parse_url("about:blank").is_none());
        assert_eq!(site_for_package("com.google.android.youtube").map(|s| s.id.as_str()), Some("youtube"));
        assert_eq!(site_for_package("com.snapchat.android").map(|s| s.id.as_str()), Some("snapchat"));
    }

    #[test]
    fn effective_features_ignore_locked_overrides() {
        let reddit = site("reddit").unwrap();
        let rule = SiteRule {
            features: [("essentials".to_string(), RuleAction::Block), ("feed".to_string(), RuleAction::Allow)]
                .into_iter()
                .collect(),
        };
        let effective = reddit.effective(Some(&rule));
        assert_eq!(effective["essentials"], RuleAction::Allow);
        assert_eq!(effective["feed"], RuleAction::Allow);
        assert_eq!(effective["recommendations"], RuleAction::Block);
        assert!(!reddit.at_least_as_restrictive(None, Some(&rule)));
        assert!(reddit.at_least_as_restrictive(Some(&rule), None));
    }
}
