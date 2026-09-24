//! The policy data model, shared by every native backend.
//!
//! This mirrors `Policy` and friends in `packages/shared/src/policy.ts`, which is the wire
//! contract the Electron main process speaks. Field names serialize as camelCase to match it
//! exactly.
//!
//! This lives in `talysman_common` rather than in each backend because it is the *contract*, not
//! an implementation detail: all three daemons must accept and emit byte-identical JSON. It was
//! previously hand-duplicated per backend, and the copies drifted — the Smart-filtering migration
//! landed in the Linux copy only, leaving Windows and macOS emitting the pre-migration
//! `{mode, domains, apps}` shape. That desynchronized the desktop app (which crashed on the
//! missing `blockedDomains`) and silently discarded incoming block lists, because the legacy
//! struct deserialized new-shape payloads into empty `domains` without error. One definition
//! makes that class of drift impossible.
//!
//! Each backend still owns how a policy is *enforced* (WinDivert filters, nftables, the hosts
//! file); this module owns only what a policy *is*.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::site_catalog::{self, CatalogSite};

/// Platform-neutral app identity; each backend reads the field relevant to its OS.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppRef {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub windows_image_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub linux_process_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub mac_bundle_id: Option<String>,
    pub label: String,
}

/// Mirrors `RuleAction` in packages/shared/src/sites/types.ts: what any policy layer decides for a
/// page. `Judge` hands the page to the AI judge (see `platform_core::judge_request`), which falls
/// back to `JudgePolicy::fallback` when it can't answer.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "lowercase")]
pub enum RuleAction {
    #[default]
    Allow,
    Judge,
    Block,
}

impl RuleAction {
    /// allow < judge < block.
    pub fn rank(self) -> u8 {
        match self {
            RuleAction::Allow => 0,
            RuleAction::Judge => 1,
            RuleAction::Block => 2,
        }
    }

    /// What the network layer (DNS sinkhole, packet filters) does: a judged page must load
    /// before it can be judged, so `Judge` lets traffic through.
    pub fn network(self) -> DefaultAction {
        match self {
            RuleAction::Block => DefaultAction::Block,
            RuleAction::Allow | RuleAction::Judge => DefaultAction::Allow,
        }
    }
}

/// The network-layer projection of `Policy::default_action` (see [`RuleAction::network`]), and
/// the two-valued fallback a judge resolves to when it can't answer. Enforcement backends
/// (nftables, pf, WinDivert) only ever see this.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DefaultAction {
    #[default]
    Allow,
    Block,
}

impl From<DefaultAction> for RuleAction {
    fn from(action: DefaultAction) -> Self {
        match action {
            DefaultAction::Allow => RuleAction::Allow,
            DefaultAction::Block => RuleAction::Block,
        }
    }
}

// Generated from scripts/blocklists/sources.mjs so the native enum, embedded resources, extension
// rulesets, and shared TypeScript metadata gain categories together.
include!("premade_list_ids.rs");

/// Mirrors `JudgeTask` in packages/shared/src/policy.ts.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JudgeTask {
    #[serde(default)]
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub notes: Option<String>,
}

/// Mirrors `JudgePolicy` in packages/shared/src/policy.ts: what the AI judge weighs pages against.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JudgePolicy {
    #[serde(default)]
    pub tasks: Vec<JudgeTask>,
    #[serde(default)]
    pub avoid: Vec<String>,
    #[serde(default)]
    pub fallback: DefaultAction,
}

/// Mirrors `SiteRule` in packages/shared/src/sites/types.ts. Feature ids are strings keyed by the
/// site catalog (`crate::site_catalog`); omitted features use the catalog default.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SiteRule {
    #[serde(default)]
    pub features: BTreeMap<String, RuleAction>,
}

/// Mirrors `Policy` in packages/shared/src/policy.ts. Layers, in order: `blocked_domains` (hard
/// block), `sites` (per-site feature rules from the site catalog), `allowed_domains` (hard allow),
/// `enabled_premade_lists`, then `default_action`. Any `Judge` action is resolved by the AI judge
/// configured in `judge`.
///
/// `sites` is keyed by catalog id *string*, not an enum: a persisted policy naming a site this
/// build's catalog doesn't know (e.g. after a rollback) must still load — unknown sites are simply
/// ignored by enforcement, and rejected only at the RPC boundary by [`Policy::validate`].
#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    pub blocked_domains: Vec<String>,
    pub allowed_domains: Vec<String>,
    pub default_action: RuleAction,
    pub judge: Option<JudgePolicy>,
    pub apps: Vec<AppRef>,
    /// Built-in bulk blocklist categories the user has toggled on. See `crate::premade_lists`.
    pub enabled_premade_lists: Vec<PremadeListId>,
    pub sites: BTreeMap<String, SiteRule>,
}

impl Policy {
    /// Enabled site rules whose site this build's catalog knows.
    pub fn catalog_sites(&self) -> impl Iterator<Item = (&'static CatalogSite, &SiteRule)> {
        self.sites
            .iter()
            .filter_map(|(id, rule)| site_catalog::site(id).map(|site| (site, rule)))
    }

    /// Every domain an enabled site rule lets through the network layer (the site's own hosts and
    /// its asset domains); the extension enforces the rule page by page.
    pub fn site_network_domains(&self) -> Vec<String> {
        self.catalog_sites()
            .flat_map(|(site, _)| site.all_domains().map(str::to_string))
            .collect()
    }

    /// Whether any layer resolves to `Judge`.
    pub fn uses_judge(&self) -> bool {
        self.default_action == RuleAction::Judge
            || self
                .catalog_sites()
                .any(|(site, rule)| site.effective(Some(rule)).values().any(|action| *action == RuleAction::Judge))
    }

    /// Reject what enforcement would silently ignore: unknown sites or features. Applied to
    /// policies arriving over RPC, never to persisted state.
    pub fn validate(&self) -> Result<(), String> {
        for (id, rule) in &self.sites {
            let site = site_catalog::site(id).ok_or_else(|| format!("Unknown site: {id}"))?;
            for feature in rule.features.keys() {
                if site.feature(feature).is_none() {
                    return Err(format!("Unknown feature for {id}: {feature}"));
                }
            }
        }
        if let Some(judge) = &self.judge {
            if judge.tasks.len() > 20 || judge.avoid.len() > 20 {
                return Err("Too many AI filtering tasks or exclusions.".into());
            }
            let too_long = |text: &str| text.chars().count() > 500;
            if judge.tasks.iter().any(|task| too_long(&task.title) || task.notes.as_deref().is_some_and(too_long))
                || judge.avoid.iter().any(|item| too_long(item))
            {
                return Err("AI filtering text is too long.".into());
            }
        }
        Ok(())
    }
}

/// Only for backward-compatible deserialization: pre-Smart-filtering policies (persisted state
/// files, or an old client's `setPolicy`/`setProfile` params) used a single `mode` selecting
/// between three preset strategies over a flat `domains` list. Kept private to this module —
/// nothing outside `Policy::deserialize` should ever construct one.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum LegacyMode {
    Blacklist,
    Whitelist,
    BlockAll,
}

/// Only for backward-compatible deserialization: the pre-v5 single-task judge configuration.
#[derive(Deserialize)]
struct LegacyIntent {
    #[serde(default)]
    positive: String,
    #[serde(default)]
    negative: Option<String>,
}

/// Permissive wire shape accepting the current `Policy` fields plus every legacy shape — the
/// `mode`/`domains` pair and the pre-v5 `softBlockedSites`/`intent` pair — so
/// `Policy::deserialize` can detect which shape it was handed and convert. These migrations are
/// permanent: old state files must keep loading.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PolicyWire {
    #[serde(default)]
    mode: Option<LegacyMode>,
    #[serde(default)]
    domains: Vec<String>,
    #[serde(default)]
    blocked_domains: Vec<String>,
    #[serde(default)]
    allowed_domains: Vec<String>,
    #[serde(default)]
    default_action: Option<RuleAction>,
    #[serde(default)]
    judge: Option<JudgePolicy>,
    #[serde(default)]
    apps: Vec<AppRef>,
    #[serde(default)]
    enabled_premade_lists: Vec<PremadeListId>,
    #[serde(default)]
    sites: Option<BTreeMap<String, SiteRule>>,
    #[serde(default)]
    soft_blocked_sites: Vec<String>,
    #[serde(default)]
    intent: Option<LegacyIntent>,
}

impl<'de> Deserialize<'de> for Policy {
    /// Detects the legacy `{mode, domains, apps}` shape by the presence of a `mode` key or the
    /// absence of `defaultAction`, and converts: `blacklist` → block only `domains` (open by
    /// default); `whitelist` → allow only `domains` (blocked by default); `block-all` → blocked by
    /// default with no domains on either list. A pre-v5 payload's `softBlockedSites` become
    /// default site rules, and its `intent` becomes a one-task judge with `defaultAction: judge`
    /// falling back to the old default. A current-shape payload passes through untouched.
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = PolicyWire::deserialize(deserializer)?;
        let is_legacy = wire.mode.is_some() || wire.default_action.is_none();
        if is_legacy {
            let (blocked_domains, allowed_domains, default_action) =
                match wire.mode.unwrap_or(LegacyMode::Blacklist) {
                    LegacyMode::Blacklist => (wire.domains, Vec::new(), RuleAction::Allow),
                    LegacyMode::Whitelist => (Vec::new(), wire.domains, RuleAction::Block),
                    LegacyMode::BlockAll => (Vec::new(), Vec::new(), RuleAction::Block),
                };
            return Ok(Policy {
                blocked_domains,
                allowed_domains,
                default_action,
                judge: None,
                apps: wire.apps,
                enabled_premade_lists: Vec::new(),
                sites: BTreeMap::new(),
            });
        }
        let mut default_action = wire.default_action.unwrap_or_default();
        let sites = wire.sites.unwrap_or_else(|| {
            wire.soft_blocked_sites
                .into_iter()
                .map(|id| (id, SiteRule::default()))
                .collect()
        });
        let judge = match (wire.judge, wire.intent) {
            (Some(judge), _) => Some(judge),
            (None, Some(intent)) if !intent.positive.trim().is_empty() => {
                let fallback = if default_action == RuleAction::Block { DefaultAction::Block } else { DefaultAction::Allow };
                default_action = RuleAction::Judge;
                Some(JudgePolicy {
                    tasks: vec![JudgeTask { id: "task-1".into(), title: intent.positive.trim().to_string(), notes: None }],
                    avoid: intent.negative.map(|n| n.trim().to_string()).filter(|n| !n.is_empty()).into_iter().collect(),
                    fallback,
                })
            }
            _ => None,
        };
        Ok(Policy {
            blocked_domains: wire.blocked_domains,
            allowed_domains: wire.allowed_domains,
            default_action,
            judge,
            apps: wire.apps,
            enabled_premade_lists: wire.enabled_premade_lists,
            sites,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> Policy {
        serde_json::from_str(json).expect("policy should deserialize")
    }

    #[test]
    fn legacy_blacklist_becomes_a_block_list_that_is_open_by_default() {
        let p = parse(r#"{"mode":"blacklist","domains":["youtube.com"],"apps":[]}"#);
        assert_eq!(p.blocked_domains, vec!["youtube.com".to_string()]);
        assert!(p.allowed_domains.is_empty());
        assert_eq!(p.default_action, RuleAction::Allow);
        assert!(p.judge.is_none());
    }

    #[test]
    fn legacy_whitelist_becomes_an_allow_list_that_is_closed_by_default() {
        let p = parse(r#"{"mode":"whitelist","domains":["docs.rs"],"apps":[]}"#);
        assert!(p.blocked_domains.is_empty());
        assert_eq!(p.allowed_domains, vec!["docs.rs".to_string()]);
        assert_eq!(p.default_action, RuleAction::Block);
    }

    #[test]
    fn legacy_block_all_becomes_closed_by_default_with_no_domains() {
        let p = parse(r#"{"mode":"block-all","domains":["ignored.com"],"apps":[]}"#);
        assert!(p.blocked_domains.is_empty());
        assert!(p.allowed_domains.is_empty());
        assert_eq!(p.default_action, RuleAction::Block);
    }

    /// The regression that broke the desktop app on Windows and macOS: a current-shape payload
    /// must survive deserialization intact. The pre-migration struct silently parsed this into an
    /// empty policy, discarding the entire block list without erroring.
    #[test]
    fn a_current_shape_policy_round_trips_without_losing_domains() {
        let json = r#"{"blockedDomains":["reddit.com","x.com"],"allowedDomains":["docs.rs"],
                       "defaultAction":"allow","judge":null,"apps":[],
                       "sites":{"youtube":{"features":{"feed":"allow","content":"judge"}}}}"#;
        let p = parse(json);
        assert_eq!(
            p.blocked_domains,
            vec!["reddit.com".to_string(), "x.com".to_string()]
        );
        assert_eq!(p.allowed_domains, vec!["docs.rs".to_string()]);
        assert_eq!(p.default_action, RuleAction::Allow);

        let back: Policy = serde_json::from_str(&serde_json::to_string(&p).unwrap()).unwrap();
        assert_eq!(back, p);
    }

    /// `getState` must emit the keys the Electron main process reads. Its `constrainPolicyToLimits`
    /// calls `.slice()` on `blockedDomains`/`allowedDomains`/`apps` unguarded, so a missing key
    /// crashes the app at bootstrap.
    #[test]
    fn serialization_emits_every_key_the_desktop_app_requires() {
        let json = serde_json::to_value(Policy::default()).unwrap();
        for key in [
            "blockedDomains",
            "allowedDomains",
            "defaultAction",
            "judge",
            "apps",
            "enabledPremadeLists",
            "sites",
        ] {
            assert!(json.get(key).is_some(), "missing `{key}` in {json}");
        }
        assert!(
            json.get("mode").is_none(),
            "legacy `mode` must not be emitted"
        );
    }

    #[test]
    fn a_pre_v5_intent_becomes_a_judged_default_falling_back_to_the_old_default() {
        let p = parse(
            r#"{"blockedDomains":[],"allowedDomains":[],"defaultAction":"block",
                "intent":{"positive":"rust compilers","negative":"social media"},"apps":[]}"#,
        );
        assert_eq!(p.default_action, RuleAction::Judge);
        let judge = p.judge.expect("judge should be present");
        assert_eq!(judge.tasks[0].title, "rust compilers");
        assert_eq!(judge.avoid, vec!["social media".to_string()]);
        assert_eq!(judge.fallback, DefaultAction::Block);
        let json = serde_json::to_value(parse(r#"{"defaultAction":"allow","intent":{"positive":"x"}}"#)).unwrap();
        assert!(json.get("intent").is_none(), "legacy `intent` must not be emitted");
    }

    #[test]
    fn pre_v5_soft_blocked_sites_become_default_site_rules() {
        let p = parse(r#"{"defaultAction":"allow","softBlockedSites":["reddit","youtube"]}"#);
        assert_eq!(p.sites.keys().collect::<Vec<_>>(), vec!["reddit", "youtube"]);
        assert!(p.sites["reddit"].features.is_empty());
        assert!(p.judge.is_none());
    }

    /// A rolled-back daemon must not wipe state over a site added in a newer catalog.
    #[test]
    fn unknown_sites_load_but_fail_validation() {
        let p = parse(r#"{"defaultAction":"allow","sites":{"tiktok":{"features":{"feed":"block"}}}}"#);
        assert!(p.sites.contains_key("tiktok"));
        assert!(p.site_network_domains().is_empty());
        assert!(p.validate().is_err());
        let bad_feature = parse(r#"{"defaultAction":"allow","sites":{"reddit":{"features":{"nope":"block"}}}}"#);
        assert!(bad_feature.validate().is_err());
        let good = parse(r#"{"defaultAction":"allow","sites":{"reddit":{"features":{"feed":"allow"}}}}"#);
        assert!(good.validate().is_ok());
    }

    #[test]
    fn judge_actions_let_traffic_through_the_network_layer() {
        assert_eq!(RuleAction::Judge.network(), DefaultAction::Allow);
        assert_eq!(RuleAction::Block.network(), DefaultAction::Block);
        let p = parse(r#"{"defaultAction":"allow","sites":{"reddit":{"features":{"content":"judge"}}}}"#);
        assert!(p.uses_judge());
    }

    /// A payload with neither `mode` nor `defaultAction` is treated as legacy-blacklist, which is
    /// the safe reading: an empty `domains` list blocks nothing rather than blocking everything.
    #[test]
    fn an_empty_object_defaults_to_blocking_nothing() {
        let p = parse("{}");
        assert!(p.blocked_domains.is_empty());
        assert_eq!(p.default_action, RuleAction::Allow);
    }

    #[test]
    fn app_refs_keep_their_per_platform_identity() {
        let p = parse(
            r#"{"mode":"blacklist","domains":[],
                "apps":[{"windowsImageName":"chrome.exe","label":"Chrome"}]}"#,
        );
        assert_eq!(p.apps[0].windows_image_name.as_deref(), Some("chrome.exe"));
        assert_eq!(p.apps[0].label, "Chrome");
        // Absent per-platform fields must not serialize back as nulls.
        let json = serde_json::to_value(&p.apps[0]).unwrap();
        assert!(json.get("linuxProcessName").is_none());
    }
}
