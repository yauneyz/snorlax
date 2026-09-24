//! LEGACY-COMPAT(v5): talk to browser extensions that predate site rules and the unified judge.
//!
//! The released pre-v5 extension understands `softBlockedSites` (Reddit and Hacker News only, with
//! their default behavior), an `intent` that turns on judging for unlisted pages, sends
//! `judge-request { extractedText }`, and reads `judge-result { relevant }`. It announces itself
//! with `softBlockCapability` and no `siteCapability`.
//!
//! Everything needed to keep that extension working lives in this file, and it fails closed:
//! whatever the old extension can't enforce exactly is hard-blocked. To drop support, delete this
//! file, its `mod` line in lib.rs, and the one-line call sites tagged LEGACY-COMPAT(v5) in
//! `natmsg_frames.rs`.

use serde_json::{json, Value};

use crate::natmsg_frames::{Blocking, ExtensionCaps};
use crate::policy::RuleAction;

/// Sites the pre-v5 extension could soft-block, with its fixed (catalog-default) behavior.
const LEGACY_SOFT_SITES: &[&str] = &["reddit", "hackernews"];

/// The pre-v5 `state` frame.
pub fn legacy_state_frame(blocking: &Blocking, caps: &ExtensionCaps) -> Value {
    // The old extension enforces catalog defaults for the sites it knows; a rule stricter than
    // that (a blocked or AI-judged feature it can't express) is hard-blocked instead.
    let (sites, hard_blocked) = blocking.resolve_sites(|site, rule| {
        caps.legacy_soft_capability >= 1
            && LEGACY_SOFT_SITES.contains(&site.id.as_str())
            && !site.stricter_than_defaults(Some(rule))
    });
    let mut blocked_domains = blocking.policy.blocked_domains.clone();
    blocked_domains.extend(hard_blocked);

    // The old extension judged unlisted pages while `intent` was set. Its DNR rules default-deny
    // under `defaultAction: block` whatever the intent says, so a judged default must be sent as
    // `allow` (losing only the judge-unavailable fallback).
    let default_action = blocking.resolve(blocking.policy.default_action);
    let intent = match (default_action, blocking.available_judge()) {
        (RuleAction::Judge, Some(judge)) => {
            let positive = judge.tasks.iter().map(|task| task.title.as_str()).collect::<Vec<_>>().join("; ");
            let mut intent = json!({ "positive": positive });
            if !judge.avoid.is_empty() {
                intent["negative"] = json!(judge.avoid.join(", "));
            }
            intent
        }
        _ => Value::Null,
    };
    json!({
        "type": "state",
        "active": blocking.active,
        "blockedDomains": blocked_domains,
        "allowedDomains": blocking.policy.allowed_domains,
        "defaultAction": if default_action == RuleAction::Block { "block" } else { "allow" },
        "intent": intent,
        "enabledPremadeLists": blocking.policy.enabled_premade_lists,
        "softBlockedSites": sites.keys().collect::<Vec<_>>(),
        "handshakeEnabled": blocking.handshake_required(),
    })
}

/// The pre-v5 extension sends the page text as `extractedText`.
pub fn legacy_judge_content(frame: &Value) -> Value {
    frame.get("extractedText").cloned().unwrap_or_else(|| json!(""))
}

/// The pre-v5 extension reads `relevant` instead of `verdict`.
pub fn add_legacy_judge_result_fields(frame: &mut Value) {
    let relevant = frame.get("verdict").and_then(Value::as_str) != Some("block");
    frame["relevant"] = json!(relevant);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::natmsg_frames::{judge_request_params, judge_result_frame, state_frame};
    use crate::policy::{DefaultAction, JudgePolicy, JudgeTask, Policy, SiteRule};

    fn legacy_caps() -> ExtensionCaps {
        ExtensionCaps { site_capability: 0, site_ids: Default::default(), legacy_soft_capability: 1 }
    }

    fn blocking(features: &[(&str, RuleAction)]) -> Blocking {
        let mut policy = Policy::default();
        policy.sites.insert(
            "reddit".into(),
            SiteRule { features: features.iter().map(|(f, a)| (f.to_string(), *a)).collect() },
        );
        policy.sites.insert("hackernews".into(), SiteRule::default());
        policy.sites.insert("youtube".into(), SiteRule::default());
        Blocking { active: true, policy, handshake_enabled: false, smart_filtering_enabled: true }
    }

    #[test]
    fn default_legacy_sites_stay_soft_and_everything_else_is_hard_blocked() {
        let frame = state_frame(&blocking(&[]), &legacy_caps());
        assert_eq!(frame["softBlockedSites"], json!(["hackernews", "reddit"]));
        assert_eq!(frame["blockedDomains"], json!(["youtube.com", "youtu.be"]));
        assert_eq!(frame["handshakeEnabled"], true);
        assert!(frame.get("sites").is_none());
    }

    #[test]
    fn stricter_than_default_rules_fail_closed_and_looser_ones_stay_soft() {
        let stricter = state_frame(&blocking(&[("search", RuleAction::Block)]), &legacy_caps());
        assert_eq!(stricter["softBlockedSites"], json!(["hackernews"]));
        assert!(stricter["blockedDomains"].as_array().unwrap().contains(&json!("reddit.com")));
        let looser = state_frame(&blocking(&[("feed", RuleAction::Allow)]), &legacy_caps());
        assert_eq!(looser["softBlockedSites"], json!(["hackernews", "reddit"]));
    }

    #[test]
    fn extensions_without_any_soft_capability_hard_block_every_site() {
        let caps = ExtensionCaps::default();
        let frame = state_frame(&blocking(&[]), &caps);
        assert_eq!(frame["softBlockedSites"], json!([]));
        assert_eq!(frame["blockedDomains"].as_array().unwrap().len(), 5);
    }

    #[test]
    fn a_judged_default_becomes_an_intent_under_an_allow_default() {
        let mut b = blocking(&[]);
        b.policy.default_action = RuleAction::Judge;
        b.policy.judge = Some(JudgePolicy {
            tasks: vec![
                JudgeTask { id: "a".into(), title: "Thesis".into(), notes: None },
                JudgeTask { id: "b".into(), title: "Taxes".into(), notes: None },
            ],
            avoid: vec!["news".into()],
            fallback: DefaultAction::Block,
        });
        let frame = state_frame(&b, &legacy_caps());
        assert_eq!(frame["defaultAction"], "allow");
        assert_eq!(frame["intent"], json!({ "positive": "Thesis; Taxes", "negative": "news" }));
        b.smart_filtering_enabled = false;
        let off = state_frame(&b, &legacy_caps());
        assert_eq!(off["defaultAction"], "block");
        assert!(off["intent"].is_null());
    }

    #[test]
    fn maps_legacy_judge_requests_and_results() {
        let params = judge_request_params(&json!({ "type": "judge-request", "requestId": "r", "url": "u", "extractedText": "old" }));
        assert_eq!(params["content"], "old");
        let frame = judge_result_frame(&json!({ "requestId": "r", "url": "u", "verdict": "block", "reason": "x" }), &legacy_caps());
        assert_eq!(frame["relevant"], false);
        let frame = judge_result_frame(&json!({ "requestId": "r", "url": "u", "verdict": "allow", "reason": "" }), &legacy_caps());
        assert_eq!(frame["relevant"], true);
    }
}
