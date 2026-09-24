//! The site catalog, as the daemon sees it: which hosts each supported site owns, which asset
//! domains its pages need, and its feature schema (ids, defaults, locked flags).
//!
//! The catalog is authored once in `packages/shared/src/sites` and generated into
//! `resources/site-catalog.json` by `pnpm generate:sites`; this module embeds that file. The
//! daemon never classifies URLs (that is page-level work done by the extension) — it only needs
//! enough to validate policies, let site traffic through the network layer, gate relaxations, and
//! hard-block a site for an extension that doesn't know it.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::Deserialize;

use crate::policy::{RuleAction, SiteRule};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogFeature {
    pub id: String,
    pub default: RuleAction,
    pub locked: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSite {
    pub id: String,
    /// Registrable domains whose pages the site owns (subdomains included).
    pub hosts: Vec<String>,
    /// Asset/CDN domains the site's pages need.
    pub network_domains: Vec<String>,
    pub features: Vec<CatalogFeature>,
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

impl CatalogSite {
    /// Every domain the site's pages and assets load from.
    pub fn all_domains(&self) -> impl Iterator<Item = &str> {
        self.hosts.iter().chain(self.network_domains.iter()).map(String::as_str)
    }

    pub fn feature(&self, id: &str) -> Option<&CatalogFeature> {
        self.features.iter().find(|feature| feature.id == id)
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
