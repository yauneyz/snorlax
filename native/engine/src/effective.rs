//! The enforceable result of every active profile: one [`Layer`] per active profile, with that
//! profile's live exemptions (pool unlocks, override (2) items) already applied, plus the
//! per-item decisions (hard > soft > allow) that blocking surfaces and the unlock popup use.
//!
//! Desktop network enforcement (DNS sinkholes, packet filters) consumes one flat `Policy`; see
//! [`flatten_network`], which is the identity for a single layer and preserves "blocked if any
//! layer blocks" for several.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::activation;
use crate::model::{BlockMode, EngineState, ItemRef, Profile};
use crate::policy::{AppRef, Policy, RuleAction, SiteRule};
use crate::policy_match::{app_matches, host_matches, is_host_blocked, is_site_network_host, same_app};
use crate::premade_lists;
use crate::site_catalog::{self, CatalogSite};
use crate::time::LocalNow;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub profile_id: String,
    /// The profile's policy with this layer's exemptions applied.
    pub policy: Policy,
    pub app_mode: BlockMode,
    pub allowed_apps: Vec<AppRef>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct EffectivePolicy {
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub generation: u64,
    /// Set while a timed override (3) is running.
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub suspended_until_ms: Option<i64>,
    pub layers: Vec<Layer>,
}

impl EffectivePolicy {
    pub fn active(&self) -> bool {
        !self.layers.is_empty()
    }
}

/// What one surface decides about one item.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Verdict {
    Allow,
    /// Usable, with these catalog features of `site` restricted (union across layers).
    Soft { site: String, features: BTreeMap<String, RuleAction> },
    /// An extension-less browser is on a page of `site` whose own feature is blocked.
    PageBlocked { site: String, feature: String },
    Hard,
}

impl Verdict {
    pub fn is_blocking(&self) -> bool {
        matches!(self, Verdict::Hard | Verdict::PageBlocked { .. })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    pub verdict: Verdict,
    /// The item this decision is about, in the vocabulary pools use.
    pub item: Option<ItemRef>,
    /// Profiles responsible for the verdict (the hard-blocking ones when hard, else the soft).
    pub blocking_profiles: Vec<String>,
}

impl Decision {
    fn allow(item: Option<ItemRef>) -> Self {
        Decision { verdict: Verdict::Allow, item, blocking_profiles: Vec::new() }
    }
}

/// A running app or visited host, as the platform identifies it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Target {
    Host(String),
    App(AppRef),
}

fn base_domain(pattern: &str) -> String {
    pattern.trim().trim_start_matches("*.").trim_end_matches('.').to_ascii_lowercase()
}

/// Do two domain patterns overlap (either covers the other's base)?
fn patterns_overlap(a: &str, b: &str) -> bool {
    let (a, b) = (base_domain(a), base_domain(b));
    !a.is_empty() && !b.is_empty() && (host_matches(&a, &b) || host_matches(&b, &a))
}

fn app_site(app: &AppRef) -> Option<&'static CatalogSite> {
    app.android_package.as_deref().and_then(site_catalog::site_for_package)
}

/// The hosts an item covers on the web.
pub fn item_hosts(item: &ItemRef) -> Vec<String> {
    match item {
        ItemRef::Domain { domain } => vec![base_domain(domain)],
        ItemRef::Catalog { id } => site_catalog::site(id)
            .map(|site| site.all_domains().map(str::to_string).collect())
            .unwrap_or_default(),
        ItemRef::App { app } => app_site(app).map(|site| site.hosts.clone()).unwrap_or_default(),
    }
}

/// The apps an item covers.
pub fn item_apps(item: &ItemRef) -> Vec<AppRef> {
    let package_ref = |package: &String| AppRef { android_package: Some(package.clone()), label: package.clone(), ..Default::default() };
    match item {
        ItemRef::Domain { domain } => site_catalog::site_for_host(&base_domain(domain))
            .map(|site| site.android_packages.iter().map(package_ref).collect())
            .unwrap_or_default(),
        ItemRef::Catalog { id } => site_catalog::site(id)
            .map(|site| site.android_packages.iter().map(package_ref).collect())
            .unwrap_or_default(),
        ItemRef::App { app } => vec![app.clone()],
    }
}

/// Does `item` (a pool member or exemption) cover `target`?
pub fn item_covers(item: &ItemRef, target: &Target) -> bool {
    match target {
        Target::Host(host) => item_hosts(item).iter().any(|pattern| host_matches(host, pattern)),
        Target::App(app) => item_apps(item).iter().any(|candidate| app_matches(candidate, app) || same_app(candidate, app)),
    }
}

/// The canonical item for a target: its catalog entry when the catalog knows it.
pub fn item_for(target: &Target) -> ItemRef {
    match target {
        Target::Host(host) => match site_catalog::site_for_host(host) {
            Some(site) => ItemRef::Catalog { id: site.id.clone() },
            None => ItemRef::Domain { domain: host.clone() },
        },
        Target::App(app) => match app_site(app) {
            Some(site) => ItemRef::Catalog { id: site.id.clone() },
            None => ItemRef::App { app: app.clone() },
        },
    }
}

/// Remove this layer's say over `items`: drop overlapping block patterns, site rules and app
/// entries, and allow-list what they cover (so default-deny and premade lists don't catch them).
pub fn materialize(profile: &Profile, items: &[ItemRef]) -> Layer {
    let mut policy = profile.config.policy.clone();
    let mut allowed_apps = profile.config.allowed_apps.clone();
    for item in items {
        for host in item_hosts(item) {
            policy.blocked_domains.retain(|pattern| !patterns_overlap(pattern, &host));
            policy.sites.retain(|id, _| {
                site_catalog::site(id).is_none_or(|site| !site.hosts.iter().any(|h| patterns_overlap(h, &host)))
            });
            if !policy.allowed_domains.iter().any(|d| host_matches(&host, d)) {
                policy.allowed_domains.push(host);
            }
        }
        for app in item_apps(item) {
            policy.apps.retain(|blocked| !(app_matches(blocked, &app) || app_matches(&app, blocked) || same_app(blocked, &app)));
            if !allowed_apps.iter().any(|a| same_app(a, &app)) {
                allowed_apps.push(app);
            }
        }
    }
    Layer { profile_id: profile.id.clone(), policy, app_mode: profile.config.app_mode, allowed_apps }
}

/// Items exempted from `profile`'s layer right now: override (2) items (unless a locked window
/// holds the profile — the key can't reach it) plus the members of the profile's pools with a
/// live unlock (pools keep working inside locked windows).
pub fn exemptions(state: &EngineState, profile: &Profile, now: &LocalNow, locked: bool) -> Vec<ItemRef> {
    let mut items: Vec<ItemRef> = if locked {
        Vec::new()
    } else {
        state.overrides.exempt.as_ref().map(|e| e.items.clone()).unwrap_or_default()
    };
    for usage in &state.pool_usage {
        if usage.profile_id != profile.id || !usage.active_until_ms.is_some_and(|until| until > now.epoch_ms) {
            continue;
        }
        if let Some(pool) = profile.config.pools.iter().find(|p| p.id == usage.pool_id) {
            items.extend(pool.items.iter().cloned());
        }
    }
    items
}

/// The layers enforced right now.
pub fn effective(state: &EngineState, now: &LocalNow) -> EffectivePolicy {
    let activations = activation::activations(state, now);
    let layers = state
        .profiles
        .iter()
        .zip(activations.iter())
        .filter(|(_, a)| a.active)
        .map(|(profile, a)| materialize(profile, &exemptions(state, profile, now, a.locked())))
        .collect();
    EffectivePolicy {
        generation: state.generation,
        suspended_until_ms: state.overrides.timed.as_ref().filter(|t| t.until_ms > now.epoch_ms).map(|t| t.until_ms),
        layers,
    }
}

// ---------------------------------------------------------------------------------------------
// Per-layer decisions
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq)]
enum LayerVerdict {
    Allow,
    Soft(&'static str, BTreeMap<String, RuleAction>),
    Hard,
}

/// The host-level layer order shared with `is_host_blocked` and site-engine.js: block list, site
/// rules (soft), allow list, premade lists, default action (judge lets the page load).
fn layer_host(policy: &Policy, host: &str) -> LayerVerdict {
    if policy.blocked_domains.iter().any(|p| host_matches(host, p)) {
        return LayerVerdict::Hard;
    }
    if let Some(site) = site_catalog::site_for_host(host) {
        if let Some(rule) = policy.sites.get(&site.id) {
            return LayerVerdict::Soft(&site.id, site.effective(Some(rule)));
        }
    }
    if is_site_network_host(policy, host) {
        return LayerVerdict::Allow;
    }
    if is_host_blocked(policy, host) {
        LayerVerdict::Hard
    } else {
        LayerVerdict::Allow
    }
}

/// App decision for one layer: blacklisted → hard (a blacklisted catalog domain blocks its app
/// too); a soft rule on the app's catalog entry → soft; whitelist mode and not allowed → hard.
fn layer_app(layer: &Layer, app: &AppRef) -> LayerVerdict {
    let policy = &layer.policy;
    if policy.apps.iter().any(|blocked| app_matches(blocked, app)) {
        return LayerVerdict::Hard;
    }
    let site = app_site(app);
    if let Some(site) = site {
        let primary = site.hosts.first().map(String::as_str).unwrap_or("");
        if policy.blocked_domains.iter().any(|p| host_matches(primary, p)) {
            return LayerVerdict::Hard;
        }
        if let Some(rule) = policy.sites.get(&site.id) {
            return LayerVerdict::Soft(&site.id, site.effective(Some(rule)));
        }
    }
    if layer.app_mode == BlockMode::Whitelist && !layer.allowed_apps.iter().any(|allowed| app_matches(allowed, app)) {
        return LayerVerdict::Hard;
    }
    LayerVerdict::Allow
}

fn combine(target: &Target, per_layer: Vec<(String, LayerVerdict)>) -> Decision {
    let item = Some(item_for(target));
    let hard: Vec<String> = per_layer.iter().filter(|(_, v)| *v == LayerVerdict::Hard).map(|(id, _)| id.clone()).collect();
    if !hard.is_empty() {
        return Decision { verdict: Verdict::Hard, item, blocking_profiles: hard };
    }
    let mut site_id: Option<&'static str> = None;
    let mut features: BTreeMap<String, RuleAction> = BTreeMap::new();
    let mut soft = Vec::new();
    for (profile_id, verdict) in per_layer {
        if let LayerVerdict::Soft(site, layer_features) = verdict {
            site_id = Some(site);
            soft.push(profile_id);
            for (feature, action) in layer_features {
                let slot = features.entry(feature).or_insert(action);
                if action.rank() > slot.rank() {
                    *slot = action;
                }
            }
        }
    }
    match site_id {
        Some(site) => Decision { verdict: Verdict::Soft { site: site.to_string(), features }, item, blocking_profiles: soft },
        None => Decision::allow(item),
    }
}

pub fn decide_host(effective: &EffectivePolicy, host: &str) -> Decision {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    let per_layer = effective.layers.iter().map(|l| (l.profile_id.clone(), layer_host(&l.policy, &host))).collect();
    combine(&Target::Host(host), per_layer)
}

pub fn decide_app(effective: &EffectivePolicy, app: &AppRef) -> Decision {
    let per_layer = effective.layers.iter().map(|l| (l.profile_id.clone(), layer_app(l, app))).collect();
    combine(&Target::App(app.clone()), per_layer)
}

/// Decision for a top-level page. Browsers that run the Talysman extension get the soft verdict
/// (the extension hides features in-page); others are route-level only: a page whose own feature
/// resolves to `block` is blocked, every other page of the site loads normally.
pub fn decide_url(effective: &EffectivePolicy, url: &str, extension_capable: bool) -> Decision {
    let Some(parsed) = site_catalog::parse_url(url) else {
        return Decision::allow(None);
    };
    let mut decision = decide_host(effective, &parsed.host);
    if extension_capable {
        return decision;
    }
    if let Verdict::Soft { site, features } = &decision.verdict {
        if let Some(catalog) = site_catalog::site(site) {
            let page = catalog.classify(&parsed);
            if features.get(&page.feature) == Some(&RuleAction::Block) {
                decision.verdict = Verdict::PageBlocked { site: site.clone(), feature: page.feature };
            } else {
                decision.verdict = Verdict::Allow;
            }
        }
    }
    decision
}

// ---------------------------------------------------------------------------------------------
// Network flattening
// ---------------------------------------------------------------------------------------------

/// One flat policy for the desktop network layer. With one layer it is that layer's policy
/// unchanged, so single-profile enforcement is byte-identical to v5. With several:
///
/// - block lists, premade lists and blacklisted apps are unioned; the default action is the
///   strictest;
/// - an allow-list pattern survives only if *no* layer blocks what it names;
/// - a site rule survives only if no layer hard-blocks the site, with features merged strictest;
/// - the judge is the first layer's that relies on one.
///
/// So a host is blocked when any layer blocks it (fail-closed in the rare cases where one allow
/// pattern can't express the intersection).
pub fn flatten_network(layers: &[Layer]) -> Policy {
    match layers {
        [] => return Policy::default(),
        [only] => return only.policy.clone(),
        _ => {}
    }
    let policies: Vec<&Policy> = layers.iter().map(|l| &l.policy).collect();
    let mut flat = Policy::default();
    for policy in &policies {
        for pattern in &policy.blocked_domains {
            if !flat.blocked_domains.contains(pattern) {
                flat.blocked_domains.push(pattern.clone());
            }
        }
        for list in &policy.enabled_premade_lists {
            if !flat.enabled_premade_lists.contains(list) {
                flat.enabled_premade_lists.push(*list);
            }
        }
        for app in &policy.apps {
            if !flat.apps.iter().any(|a| same_app(a, app)) {
                flat.apps.push(app.clone());
            }
        }
        if policy.default_action.rank() > flat.default_action.rank() {
            flat.default_action = policy.default_action;
        }
    }
    flat.judge = policies
        .iter()
        .find(|p| p.judge.is_some() && p.uses_judge())
        .or_else(|| policies.iter().find(|p| p.judge.is_some()))
        .and_then(|p| p.judge.clone());

    let blocked_anywhere = |host: &str| policies.iter().any(|p| is_host_blocked(p, host));
    for policy in &policies {
        for pattern in &policy.allowed_domains {
            let base = base_domain(pattern);
            if !base.is_empty() && !blocked_anywhere(&base) && !flat.allowed_domains.contains(pattern) {
                flat.allowed_domains.push(pattern.clone());
            }
        }
    }

    let mut site_ids: Vec<&String> = policies.iter().flat_map(|p| p.sites.keys()).collect();
    site_ids.sort();
    site_ids.dedup();
    for id in site_ids {
        let Some(site) = site_catalog::site(id) else { continue };
        let primary = site.hosts.first().map(String::as_str).unwrap_or("");
        if blocked_anywhere(primary) {
            continue;
        }
        let mut features: BTreeMap<String, RuleAction> = BTreeMap::new();
        for policy in &policies {
            if let Some(rule) = policy.sites.get(id) {
                for (feature, action) in site.effective(Some(rule)) {
                    let slot = features.entry(feature).or_insert(action);
                    if action.rank() > slot.rank() {
                        *slot = action;
                    }
                }
            }
        }
        flat.sites.insert(id.clone(), SiteRule { features });
    }
    flat
}

/// DNS-sinkhole domains for a set of layers (union of each layer's own set — exact).
pub fn dns_sinkhole_domains(layers: &[Layer]) -> std::collections::BTreeSet<String> {
    layers.iter().flat_map(|l| crate::policy_match::effective_dns_sinkhole_domains(&l.policy)).collect()
}

/// Is `host` blocked by any premade list any layer enables (ignores allow lists)?
pub fn premade_blocks(layers: &[Layer], host: &str) -> bool {
    layers.iter().any(|l| premade_lists::is_blocked_by_premade(&l.policy.enabled_premade_lists, host))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Latch, LatchSource, ProfileConfig};

    fn profile(id: &str, policy: Policy) -> Profile {
        Profile {
            id: id.into(),
            name: id.into(),
            color: "#000".into(),
            created_at_ms: 0,
            config: ProfileConfig { policy, ..Default::default() },
            latch: Latch::On { since_ms: 0, source: LatchSource::User },
        }
    }

    fn policy(blocked: &[&str], allowed: &[&str], default_action: RuleAction) -> Policy {
        Policy {
            blocked_domains: blocked.iter().map(|s| s.to_string()).collect(),
            allowed_domains: allowed.iter().map(|s| s.to_string()).collect(),
            default_action,
            ..Default::default()
        }
    }

    fn soft(site: &str) -> Policy {
        let mut p = Policy::default();
        p.sites.insert(site.into(), SiteRule::default());
        p
    }

    fn layer(id: &str, policy: Policy) -> Layer {
        materialize(&profile(id, policy), &[])
    }

    fn eff(layers: Vec<Layer>) -> EffectivePolicy {
        EffectivePolicy { generation: 0, suspended_until_ms: None, layers }
    }

    fn instagram_app() -> AppRef {
        AppRef { android_package: Some("com.instagram.android".into()), label: "Instagram".into(), ..Default::default() }
    }

    #[test]
    fn hard_plus_soft_is_hard() {
        let mut blocks_app = Policy::default();
        blocks_app.apps.push(instagram_app());
        let e = eff(vec![layer("a", blocks_app), layer("b", soft("instagram"))]);
        let d = decide_app(&e, &instagram_app());
        assert_eq!(d.verdict, Verdict::Hard);
        assert_eq!(d.blocking_profiles, vec!["a".to_string()]);
        assert_eq!(d.item, Some(ItemRef::Catalog { id: "instagram".into() }));
    }

    #[test]
    fn whitelist_miss_plus_soft_is_soft() {
        let mut p = soft("youtube");
        p.default_action = RuleAction::Block;
        let mut l = layer("a", p);
        l.app_mode = BlockMode::Whitelist;
        let youtube = AppRef { android_package: Some("com.google.android.youtube".into()), label: "YouTube".into(), ..Default::default() };
        let e = eff(vec![l]);
        assert!(matches!(decide_app(&e, &youtube).verdict, Verdict::Soft { .. }));
        let other = AppRef { android_package: Some("com.example.game".into()), label: "Game".into(), ..Default::default() };
        assert_eq!(decide_app(&e, &other).verdict, Verdict::Hard);
        assert!(matches!(decide_host(&e, "www.youtube.com").verdict, Verdict::Soft { .. }));
        assert_eq!(decide_host(&e, "example.com").verdict, Verdict::Hard);
    }

    #[test]
    fn soft_features_union_across_layers() {
        let mut a = Policy::default();
        a.sites.insert("youtube".into(), SiteRule { features: [("feed".to_string(), RuleAction::Allow)].into() });
        let mut b = Policy::default();
        b.sites.insert("youtube".into(), SiteRule { features: [("feed".to_string(), RuleAction::Block)].into() });
        let d = decide_host(&eff(vec![layer("a", a), layer("b", b)]), "youtube.com");
        let Verdict::Soft { features, .. } = d.verdict else { panic!() };
        assert_eq!(features["feed"], RuleAction::Block);
        assert_eq!(d.blocking_profiles.len(), 2);
    }

    #[test]
    fn extensionless_browsers_block_only_pages_whose_feature_is_blocked() {
        let mut p = Policy::default();
        p.sites.insert("youtube".into(), SiteRule { features: [("shorts".to_string(), RuleAction::Block)].into() });
        let e = eff(vec![layer("a", p)]);
        let shorts = "https://www.youtube.com/shorts/dQw4w9WgXcQ";
        assert_eq!(
            decide_url(&e, shorts, false).verdict,
            Verdict::PageBlocked { site: "youtube".into(), feature: "shorts".into() }
        );
        assert!(matches!(decide_url(&e, "https://www.youtube.com/", false).verdict, Verdict::PageBlocked { .. }));
        assert_eq!(decide_url(&e, "https://www.youtube.com/watch?v=dQw4w9WgXcQ", false).verdict, Verdict::Allow);
        assert!(matches!(decide_url(&e, shorts, true).verdict, Verdict::Soft { .. }));
        assert_eq!(decide_url(&e, "https://example.com/", false).verdict, Verdict::Allow);
    }

    #[test]
    fn exemptions_lift_hard_and_soft_blocks_for_the_item_only() {
        let mut p = policy(&["*.instagram.com", "reddit.com"], &[], RuleAction::Allow);
        p.sites.insert("youtube".into(), SiteRule::default());
        p.apps.push(instagram_app());
        let prof = profile("a", p);
        let l = materialize(&prof, &[ItemRef::Catalog { id: "instagram".into() }, ItemRef::Domain { domain: "youtube.com".into() }]);
        let e = eff(vec![l]);
        assert_eq!(decide_host(&e, "www.instagram.com").verdict, Verdict::Allow);
        assert_eq!(decide_app(&e, &instagram_app()).verdict, Verdict::Allow);
        assert_eq!(decide_host(&e, "youtube.com").verdict, Verdict::Allow);
        assert_eq!(decide_host(&e, "reddit.com").verdict, Verdict::Hard);
    }

    #[test]
    fn a_domain_item_also_covers_the_catalog_app() {
        let item = ItemRef::Domain { domain: "instagram.com".into() };
        assert!(item_covers(&item, &Target::App(instagram_app())));
        assert!(item_covers(&item, &Target::Host("www.instagram.com".into())));
        assert!(!item_covers(&item, &Target::Host("reddit.com".into())));
    }

    #[test]
    fn a_single_layer_flattens_to_itself() {
        let mut p = policy(&["reddit.com"], &["docs.rs"], RuleAction::Block);
        p.sites.insert("youtube".into(), SiteRule::default());
        assert_eq!(flatten_network(&[layer("a", p.clone())]), p);
    }

    #[test]
    fn flattening_blocks_whatever_any_layer_blocks() {
        use crate::policy::PremadeListId;
        let whitelist_a = policy(&[], &["docs.rs", "github.com"], RuleAction::Block);
        let whitelist_b = policy(&[], &["github.com", "*.rust-lang.org"], RuleAction::Block);
        let mut premade = policy(&["x.com"], &["amazon.com"], RuleAction::Allow);
        premade.enabled_premade_lists = vec![PremadeListId::Shopping];
        let shopping_only = {
            let mut p = Policy::default();
            p.enabled_premade_lists = vec![PremadeListId::Shopping];
            p
        };
        let layers_sets = vec![
            vec![layer("a", whitelist_a.clone()), layer("b", whitelist_b.clone())],
            vec![layer("a", premade.clone()), layer("b", shopping_only.clone())],
            vec![layer("a", premade.clone()), layer("b", Policy::default())],
            vec![layer("a", soft("youtube")), layer("b", whitelist_a.clone())],
            vec![layer("a", soft("youtube")), layer("b", policy(&["youtube.com"], &[], RuleAction::Allow))],
        ];
        let hosts = [
            "docs.rs", "github.com", "api.github.com", "doc.rust-lang.org", "rust-lang.org", "x.com",
            "amazon.com", "www.amazon.com", "ebay.com", "example.com", "youtube.com", "www.youtube.com",
            "i.ytimg.com",
        ];
        for layers in layers_sets {
            let flat = flatten_network(&layers);
            for host in hosts {
                let any = layers.iter().any(|l| is_host_blocked(&l.policy, host));
                assert_eq!(is_host_blocked(&flat, host), any, "{host} in {:?}", layers.iter().map(|l| &l.policy).collect::<Vec<_>>());
            }
        }
    }
}
