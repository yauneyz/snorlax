//! Frames exchanged between the native-messaging host (talysman-natmsg) and the browser
//! extension, shared by the Unix and Windows hosts so both speak exactly one protocol.
//!
//! The host tracks the daemon's blocking state ([`Blocking`]) and, per extension connection, what
//! that extension build can enforce ([`ExtensionCaps`], from its `hello`). [`state_frame`] then
//! resolves the policy into the frame the extension applies:
//!
//! - `judge` actions are pre-resolved to the judge's fallback when AI filtering isn't available,
//!   so the extension never waits on a judge that can't answer;
//! - every enabled site the extension's catalog doesn't know is hard-blocked (its hosts are folded
//!   into `blockedDomains`), so a daemon with a newer catalog fails closed on an older extension.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};

use crate::natmsg_legacy;
use crate::policy::{DefaultAction, JudgePolicy, Policy, RuleAction};
use crate::site_catalog::CatalogSite;

/// The site-rule protocol generation this host speaks. Extensions advertise theirs as
/// `siteCapability`; anything older gets the legacy frame (see `natmsg_legacy`).
pub const SITE_CAPABILITY: u64 = 3;

/// The daemon state the host mirrors from `getState` and pushed events.
#[derive(Clone, Default, PartialEq)]
pub struct Blocking {
    pub active: bool,
    pub policy: Policy,
    pub handshake_enabled: bool,
    pub smart_filtering_enabled: bool,
}

impl Blocking {
    /// Replace the policy from a `getState` result or `policyChanged` payload. A payload that
    /// doesn't parse keeps the previous policy — never fall open to an empty one.
    pub fn apply_policy_json(&mut self, policy: &Value) {
        match serde_json::from_value::<Policy>(policy.clone()) {
            Ok(policy) => self.policy = policy,
            Err(error) => eprintln!("talysman-natmsg: ignoring unparseable policy: {error}"),
        }
    }

    /// The judge policy, if AI filtering can actually answer right now.
    pub fn available_judge(&self) -> Option<&JudgePolicy> {
        self.policy
            .judge
            .as_ref()
            .filter(|judge| self.smart_filtering_enabled && !judge.tasks.is_empty())
    }

    /// Resolve `judge` to the judge's fallback when no judge can answer.
    pub fn resolve(&self, action: RuleAction) -> RuleAction {
        if action != RuleAction::Judge || self.available_judge().is_some() {
            return action;
        }
        self.policy.judge.as_ref().map_or(DefaultAction::Allow, |judge| judge.fallback).into()
    }

    /// Site rules resolved for the extension: sites `enforceable` accepts get their effective
    /// feature actions; every other enabled site is returned as hosts to hard-block.
    pub fn resolve_sites(
        &self,
        enforceable: impl Fn(&CatalogSite, &crate::policy::SiteRule) -> bool,
    ) -> (BTreeMap<String, BTreeMap<String, RuleAction>>, Vec<String>) {
        let mut sites = BTreeMap::new();
        let mut hard_blocked = Vec::new();
        for (site, rule) in self.policy.catalog_sites() {
            if enforceable(site, rule) {
                let features = site
                    .effective(Some(rule))
                    .into_iter()
                    .map(|(feature, action)| (feature, self.resolve(action)))
                    .collect();
                sites.insert(site.id.clone(), features);
            } else {
                hard_blocked.extend(site.hosts.iter().cloned());
            }
        }
        (sites, hard_blocked)
    }

    /// Site rules need the extension's handshake: without it nothing enforces them in the page.
    pub fn handshake_required(&self) -> bool {
        self.handshake_enabled || self.policy.catalog_sites().next().is_some()
    }
}

/// What one connected extension build can enforce, from its `hello` frame.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ExtensionCaps {
    pub site_capability: u64,
    /// Catalog site ids the extension build knows.
    pub site_ids: BTreeSet<String>,
    /// LEGACY-COMPAT(v5): the pre-v5 `softBlockCapability`.
    pub legacy_soft_capability: u64,
}

impl ExtensionCaps {
    pub fn from_hello(hello: &Value) -> Self {
        ExtensionCaps {
            site_capability: hello.get("siteCapability").and_then(Value::as_u64).unwrap_or(0),
            site_ids: hello
                .get("siteIds")
                .and_then(Value::as_array)
                .map(|ids| ids.iter().filter_map(Value::as_str).map(str::to_string).collect())
                .unwrap_or_default(),
            legacy_soft_capability: hello.get("softBlockCapability").and_then(Value::as_u64).unwrap_or(0),
        }
    }

    pub fn speaks_site_rules(&self) -> bool {
        self.site_capability >= SITE_CAPABILITY
    }
}

/// The `state` frame for one extension.
pub fn state_frame(blocking: &Blocking, caps: &ExtensionCaps) -> Value {
    if !caps.speaks_site_rules() {
        return natmsg_legacy::legacy_state_frame(blocking, caps); // LEGACY-COMPAT(v5)
    }
    let (sites, hard_blocked) = blocking.resolve_sites(|site, _| caps.site_ids.contains(&site.id));
    let mut blocked_domains = blocking.policy.blocked_domains.clone();
    blocked_domains.extend(hard_blocked);
    let sites: BTreeMap<String, Value> = sites
        .into_iter()
        .map(|(id, features)| (id, json!({ "features": features })))
        .collect();
    json!({
        "type": "state",
        "active": blocking.active,
        "blockedDomains": blocked_domains,
        "allowedDomains": blocking.policy.allowed_domains,
        "defaultAction": blocking.resolve(blocking.policy.default_action),
        "enabledPremadeLists": blocking.policy.enabled_premade_lists,
        "sites": sites,
        "judge": blocking.available_judge(),
        "handshakeEnabled": blocking.handshake_required(),
    })
}

/// `judgeRequest` RPC params from the extension's `judge-request` frame. The daemon attaches the
/// judge policy; the extension only describes the page.
pub fn judge_request_params(frame: &Value) -> Value {
    let content = frame
        .get("content")
        .cloned()
        .unwrap_or_else(|| natmsg_legacy::legacy_judge_content(frame)); // LEGACY-COMPAT(v5)
    let mut params = json!({
        "requestId": frame.get("requestId").cloned().unwrap_or(Value::Null),
        "url": frame.get("url").cloned().unwrap_or(Value::Null),
        "title": frame.get("title").cloned().unwrap_or_else(|| json!("")),
        "content": content,
    });
    if let Some(context) = frame.get("context").filter(|context| context.is_object()) {
        params["context"] = json!({
            "site": context.get("site").cloned().unwrap_or(Value::Null),
            "feature": context.get("feature").cloned().unwrap_or(Value::Null),
        });
    }
    params
}

/// The outbound `judge-result` frame for a `judgeResult` event. Pure relay.
pub fn judge_result_frame(payload: &Value, caps: &ExtensionCaps) -> Value {
    let mut frame = json!({
        "type": "judge-result",
        "requestId": payload.get("requestId").cloned().unwrap_or(Value::Null),
        "url": payload.get("url").cloned().unwrap_or(Value::Null),
        "verdict": payload.get("verdict").cloned().unwrap_or(Value::Null),
        "reason": payload.get("reason").cloned().unwrap_or(Value::Null),
    });
    if !caps.speaks_site_rules() {
        natmsg_legacy::add_legacy_judge_result_fields(&mut frame); // LEGACY-COMPAT(v5)
    }
    frame
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::{JudgeTask, SiteRule};

    fn caps(ids: &[&str]) -> ExtensionCaps {
        ExtensionCaps {
            site_capability: SITE_CAPABILITY,
            site_ids: ids.iter().map(|id| id.to_string()).collect(),
            legacy_soft_capability: 1,
        }
    }

    fn judge() -> JudgePolicy {
        JudgePolicy {
            tasks: vec![JudgeTask { id: "a".into(), title: "Write the thesis".into(), notes: None }],
            avoid: vec!["sports".into()],
            fallback: DefaultAction::Block,
        }
    }

    fn blocking() -> Blocking {
        let mut policy = Policy::default();
        policy.blocked_domains = vec!["example.com".into()];
        policy.default_action = RuleAction::Judge;
        policy.judge = Some(judge());
        policy.sites.insert("reddit".into(), SiteRule { features: [("content".to_string(), RuleAction::Judge)].into() });
        policy.sites.insert("youtube".into(), SiteRule::default());
        policy.sites.insert("from-the-future".into(), SiteRule::default());
        Blocking { active: true, policy, handshake_enabled: false, smart_filtering_enabled: true }
    }

    #[test]
    fn resolves_site_features_and_hard_blocks_sites_the_extension_does_not_know() {
        let frame = state_frame(&blocking(), &caps(&["reddit"]));
        assert_eq!(frame["sites"]["reddit"]["features"]["content"], "judge");
        assert_eq!(frame["sites"]["reddit"]["features"]["feed"], "block");
        assert!(frame["sites"].get("youtube").is_none());
        assert!(frame["sites"].get("from-the-future").is_none());
        assert_eq!(frame["blockedDomains"], json!(["example.com", "youtube.com", "youtu.be"]));
        assert_eq!(frame["defaultAction"], "judge");
        assert_eq!(frame["judge"]["tasks"][0]["title"], "Write the thesis");
        assert_eq!(frame["handshakeEnabled"], true);
        assert!(frame.get("softBlockedSites").is_none());
        assert!(frame.get("intent").is_none());
    }

    #[test]
    fn judge_actions_fall_back_when_ai_filtering_is_unavailable() {
        let mut b = blocking();
        b.smart_filtering_enabled = false;
        let frame = state_frame(&b, &caps(&["reddit", "youtube"]));
        assert!(frame["judge"].is_null());
        assert_eq!(frame["defaultAction"], "block");
        assert_eq!(frame["sites"]["reddit"]["features"]["content"], "block");
        assert_eq!(frame["sites"]["youtube"]["features"]["content"], "allow");
    }

    #[test]
    fn relays_judge_requests_and_results() {
        let params = judge_request_params(&json!({
            "type": "judge-request", "requestId": "r1", "url": "https://a.test/", "title": "A",
            "content": "text", "context": { "site": "reddit", "feature": "content", "extra": 1 },
        }));
        assert_eq!(params, json!({
            "requestId": "r1", "url": "https://a.test/", "title": "A", "content": "text",
            "context": { "site": "reddit", "feature": "content" },
        }));
        let frame = judge_result_frame(&json!({ "requestId": "r1", "url": "u", "verdict": "block", "reason": "off-task" }), &caps(&[]));
        assert_eq!(frame["verdict"], "block");
        assert!(frame.get("relevant").is_none());
    }

    #[test]
    fn keeps_the_previous_policy_when_a_payload_does_not_parse() {
        let mut b = blocking();
        b.apply_policy_json(&json!({ "defaultAction": "sideways" }));
        assert_eq!(b.policy.default_action, RuleAction::Judge);
    }
}
