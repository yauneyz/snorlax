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

use serde::{Deserialize, Serialize};

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

/// Mirrors `Policy['defaultAction']` in packages/shared/src/policy.ts: the fallback for domains
/// on neither hard list, and the fail-closed/fail-open fallback when a Smart-filtering judge is
/// unreachable (see the Linux backend's `Core::sweep_expired_judges`).
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DefaultAction {
    Allow,
    Block,
}

impl Default for DefaultAction {
    /// Matches the old default (`Mode::Blacklist` with empty `domains`, i.e. nothing blocked) so
    /// a brand-new default profile keeps behaving the same as before this migration.
    fn default() -> Self {
        DefaultAction::Allow
    }
}

/// Mirrors `PolicyIntent` in packages/shared/src/policy.ts. Non-null on a `Policy` activates
/// Smart filtering for domains that fall through both hard lists.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Intent {
    pub positive: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub negative: Option<String>,
}

/// Mirrors `Policy` in packages/shared/src/policy.ts. There is no `mode` anymore: `blockedDomains`
/// and `allowedDomains` are independent hard lists (never judged), `defaultAction` decides
/// everything that hits neither list, and `intent` is an optional third layer.
#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    pub blocked_domains: Vec<String>,
    pub allowed_domains: Vec<String>,
    pub default_action: DefaultAction,
    pub intent: Option<Intent>,
    pub apps: Vec<AppRef>,
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

/// Permissive wire shape accepting both the current `Policy` fields and the legacy `mode`/
/// `domains` pair, so `Policy::deserialize` can detect which shape it was handed and convert.
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
    default_action: Option<DefaultAction>,
    #[serde(default)]
    intent: Option<Intent>,
    #[serde(default)]
    apps: Vec<AppRef>,
}

impl<'de> Deserialize<'de> for Policy {
    /// Detects the legacy `{mode, domains, apps}` shape by the presence of a `mode` key or the
    /// absence of `defaultAction`, and converts: `blacklist` → block only `domains` (open by
    /// default); `whitelist` → allow only `domains` (blocked by default); `block-all` → blocked by
    /// default with no domains on either list. A current-shape payload passes through untouched.
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = PolicyWire::deserialize(deserializer)?;
        let is_legacy = wire.mode.is_some() || wire.default_action.is_none();
        if is_legacy {
            let policy = match wire.mode.unwrap_or(LegacyMode::Blacklist) {
                LegacyMode::Blacklist => Policy {
                    blocked_domains: wire.domains,
                    allowed_domains: Vec::new(),
                    default_action: DefaultAction::Allow,
                    intent: None,
                    apps: wire.apps,
                },
                LegacyMode::Whitelist => Policy {
                    blocked_domains: Vec::new(),
                    allowed_domains: wire.domains,
                    default_action: DefaultAction::Block,
                    intent: None,
                    apps: wire.apps,
                },
                LegacyMode::BlockAll => Policy {
                    blocked_domains: Vec::new(),
                    allowed_domains: Vec::new(),
                    default_action: DefaultAction::Block,
                    intent: None,
                    apps: wire.apps,
                },
            };
            Ok(policy)
        } else {
            Ok(Policy {
                blocked_domains: wire.blocked_domains,
                allowed_domains: wire.allowed_domains,
                default_action: wire.default_action.unwrap_or_default(),
                intent: wire.intent,
                apps: wire.apps,
            })
        }
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
        assert_eq!(p.default_action, DefaultAction::Allow);
        assert!(p.intent.is_none());
    }

    #[test]
    fn legacy_whitelist_becomes_an_allow_list_that_is_closed_by_default() {
        let p = parse(r#"{"mode":"whitelist","domains":["docs.rs"],"apps":[]}"#);
        assert!(p.blocked_domains.is_empty());
        assert_eq!(p.allowed_domains, vec!["docs.rs".to_string()]);
        assert_eq!(p.default_action, DefaultAction::Block);
    }

    #[test]
    fn legacy_block_all_becomes_closed_by_default_with_no_domains() {
        let p = parse(r#"{"mode":"block-all","domains":["ignored.com"],"apps":[]}"#);
        assert!(p.blocked_domains.is_empty());
        assert!(p.allowed_domains.is_empty());
        assert_eq!(p.default_action, DefaultAction::Block);
    }

    /// The regression that broke the desktop app on Windows and macOS: a current-shape payload
    /// must survive deserialization intact. The pre-migration struct silently parsed this into an
    /// empty policy, discarding the entire block list without erroring.
    #[test]
    fn a_current_shape_policy_round_trips_without_losing_domains() {
        let json = r#"{"blockedDomains":["reddit.com","x.com"],"allowedDomains":["docs.rs"],
                       "defaultAction":"allow","intent":null,"apps":[]}"#;
        let p = parse(json);
        assert_eq!(
            p.blocked_domains,
            vec!["reddit.com".to_string(), "x.com".to_string()]
        );
        assert_eq!(p.allowed_domains, vec!["docs.rs".to_string()]);
        assert_eq!(p.default_action, DefaultAction::Allow);

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
            "intent",
            "apps",
        ] {
            assert!(json.get(key).is_some(), "missing `{key}` in {json}");
        }
        assert!(
            json.get("mode").is_none(),
            "legacy `mode` must not be emitted"
        );
    }

    #[test]
    fn intent_survives_a_round_trip_and_activates_smart_filtering() {
        let p = parse(
            r#"{"blockedDomains":[],"allowedDomains":[],"defaultAction":"block",
                "intent":{"positive":"rust compilers","negative":"social media"},"apps":[]}"#,
        );
        let intent = p.intent.expect("intent should be present");
        assert_eq!(intent.positive, "rust compilers");
        assert_eq!(intent.negative.as_deref(), Some("social media"));
    }

    /// A payload with neither `mode` nor `defaultAction` is treated as legacy-blacklist, which is
    /// the safe reading: an empty `domains` list blocks nothing rather than blocking everything.
    #[test]
    fn an_empty_object_defaults_to_blocking_nothing() {
        let p = parse("{}");
        assert!(p.blocked_domains.is_empty());
        assert_eq!(p.default_action, DefaultAction::Allow);
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
