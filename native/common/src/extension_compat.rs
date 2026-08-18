//! Temporary compatibility boundary for extension heartbeats and the pushed state frame.
//!
//! Store review can leave an older extension installed after a newer daemon has shipped. Keep the
//! browser-to-daemon translation and tolerant daemon-side parsing here until that rollout window
//! has closed. Removing this module is intentionally mechanical; see `daemon-compatibility-rollback.md`.
//!
//! Two boundaries live here:
//!   * `relay_heartbeat_params` / `parse_service_heartbeat` — extension → daemon (0.1.x onward).
//!   * `current_state_fields` — daemon → extension, for a daemon still on the legacy policy
//!     model (macOS). It is the inverse of `legacy_state_fields`: without it, a current extension
//!     reads no `blockedDomains`/`defaultAction` and likewise applies zero rules.
//!   * `legacy_state_fields` — daemon → extension. Smart filtering replaced the state frame's
//!     `mode`/`domains` pair with `blockedDomains`/`allowedDomains`/`defaultAction`, but the
//!     published 0.2.1 extension still switches on `mode` and reads `domains`. Sending it a frame
//!     without those fields makes its `buildRules` fall through every case and apply **zero** DNR
//!     rules — it silently stops blocking. Emitting both shapes keeps that build enforcing the hard
//!     lists until the newer extension has rolled out.

use serde_json::{json, Value};

/// The heartbeat fields understood by both the store extension (0.1.x) and the current extension.
///
/// Unknown fields are deliberately ignored and missing optional metadata remains `null`. Health is
/// forwarded unchanged so the daemon can continue to fail closed when either required signal is
/// absent or false.
pub fn relay_heartbeat_params(frame: &Value, browser_pid: u32) -> Value {
    json!({
        "browserPid": browser_pid,
        "browser": frame.get("browser").and_then(Value::as_str).unwrap_or(""),
        "workerSessionId": optional_field(frame, "workerSessionId"),
        "sequence": optional_field(frame, "sequence"),
        "sentAt": optional_field(frame, "sentAt"),
        "extensionVersion": optional_field(frame, "extensionVersion"),
        "lockedActive": optional_field(frame, "lockedActive"),
        "health": frame.get("health").cloned().unwrap_or_else(|| json!({})),
    })
}

fn optional_field(frame: &Value, name: &str) -> Value {
    frame.get(name).cloned().unwrap_or(Value::Null)
}

/// The daemon-relevant subset of a relayed heartbeat.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeartbeatReport {
    pub browser_pid: u32,
    pub browser: String,
    pub sequence: u64,
    pub extension_version: Option<String>,
    pub healthy: bool,
}

/// Parse both legacy and current heartbeat parameters without allowing malformed health data to
/// disable watchdog enforcement.
pub fn parse_service_heartbeat(params: &Value) -> HeartbeatReport {
    let health = params.get("health");
    let can_block = health
        .and_then(|value| value.get("canBlock"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let permissions_ok = health
        .and_then(|value| value.get("permissionsOk"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    HeartbeatReport {
        browser_pid: params
            .get("browserPid")
            .and_then(Value::as_u64)
            .and_then(|pid| u32::try_from(pid).ok())
            .unwrap_or(0),
        browser: params
            .get("browser")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned(),
        sequence: params.get("sequence").and_then(Value::as_u64).unwrap_or(0),
        extension_version: params
            .get("extensionVersion")
            .and_then(Value::as_str)
            .filter(|version| !version.is_empty())
            .map(str::to_owned),
        healthy: can_block && permissions_ok,
    }
}

/// Synthesize the legacy `mode`/`domains` pair from a current policy's hard lists, for the
/// benefit of extensions predating Smart filtering.
///
/// The mapping mirrors the three presets the legacy `buildRules` understood:
///   * `defaultAction: "block"` with an allow list → `whitelist` over `allowedDomains`. The
///     policy's `blockedDomains` are subsumed: whitelist already denies everything unlisted.
///   * `defaultAction: "block"` with no allow list → `block-all`.
///   * `defaultAction: "allow"` → `blacklist` over `blockedDomains`. A Smart-filtering profile
///     lands here too, so an old extension still enforces the hard block list and merely skips
///     the judge layer — the same fail-open stance `defaultAction: "allow"` already encodes.
pub fn legacy_state_fields(
    default_action: &str,
    blocked_domains: &[String],
    allowed_domains: &[String],
) -> (&'static str, Vec<String>) {
    if default_action == "block" {
        if allowed_domains.is_empty() {
            ("block-all", Vec::new())
        } else {
            ("whitelist", allowed_domains.to_vec())
        }
    } else {
        ("blacklist", blocked_domains.to_vec())
    }
}

/// Synthesize the current `blockedDomains`/`allowedDomains`/`defaultAction` triple from a legacy
/// `mode`/`domains` policy, for daemons that have not yet migrated off the three-preset model.
///
/// The inverse of [`legacy_state_fields`]; `intent` has no legacy equivalent, so a daemon using
/// this cannot drive Smart filtering and should keep sending `intent: null`.
pub fn current_state_fields(mode: &str, domains: &[String]) -> (Vec<String>, Vec<String>, &'static str) {
    match mode {
        "whitelist" => (Vec::new(), domains.to_vec(), "block"),
        "block-all" => (Vec::new(), Vec::new(), "block"),
        // "blacklist", and anything unrecognized: the open-by-default preset, which is also what a
        // freshly-constructed daemon-side state means before the first snapshot lands.
        _ => (domains.to_vec(), Vec::new(), "allow"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Captured shape emitted by the store extension before the adaptive-heartbeat release. Keep
    // this fixture literal so changes to either side of the bridge cannot silently redefine it.
    const STORE_EXTENSION_0_1_HEARTBEAT: &str = r#"{
        "type": "heartbeat",
        "sequence": 17,
        "sentAt": 1722470400000,
        "browser": "chrome",
        "workerSessionId": "legacy-worker",
        "extensionVersion": "0.1.0",
        "lockedActive": true,
        "health": {
            "canBlock": true,
            "permissionsOk": true,
            "dnrRulesApplied": true
        }
    }"#;

    #[test]
    fn store_extension_0_1_heartbeat_remains_healthy() {
        let frame: Value = serde_json::from_str(STORE_EXTENSION_0_1_HEARTBEAT).unwrap();
        let params = relay_heartbeat_params(&frame, 4242);
        let report = parse_service_heartbeat(&params);

        assert_eq!(report.browser_pid, 4242);
        assert_eq!(report.browser, "chrome");
        assert_eq!(report.sequence, 17);
        assert_eq!(report.extension_version.as_deref(), Some("0.1.0"));
        assert!(report.healthy);
        assert_eq!(params["workerSessionId"], "legacy-worker");
        assert_eq!(params["lockedActive"], true);
        assert_eq!(params["health"]["dnrRulesApplied"], true);
    }

    #[test]
    fn optional_legacy_metadata_can_be_absent() {
        let params = relay_heartbeat_params(
            &json!({
                "type": "heartbeat",
                "health": { "canBlock": true, "permissionsOk": true }
            }),
            7,
        );
        let report = parse_service_heartbeat(&params);

        assert_eq!(report.browser_pid, 7);
        assert_eq!(report.sequence, 0);
        assert_eq!(report.extension_version, None);
        assert!(report.healthy);
    }

    #[test]
    fn incomplete_or_false_health_fails_closed() {
        for health in [
            json!({}),
            json!({ "canBlock": true }),
            json!({ "permissionsOk": true }),
            json!({ "canBlock": false, "permissionsOk": true }),
            json!({ "canBlock": true, "permissionsOk": false }),
        ] {
            let report = parse_service_heartbeat(&json!({
                "browserPid": 9,
                "health": health,
            }));
            assert!(!report.healthy);
        }
    }

    #[test]
    fn default_action_allow_maps_to_a_blacklist_over_the_block_list() {
        let blocked = vec!["reddit.com".to_string(), "x.com".to_string()];
        let allowed = vec!["docs.rs".to_string()];
        let (mode, domains) = legacy_state_fields("allow", &blocked, &allowed);

        assert_eq!(mode, "blacklist");
        assert_eq!(domains, blocked);
    }

    #[test]
    fn default_action_block_with_an_allow_list_maps_to_a_whitelist() {
        let blocked = vec!["reddit.com".to_string()];
        let allowed = vec!["docs.rs".to_string()];
        let (mode, domains) = legacy_state_fields("block", &blocked, &allowed);

        assert_eq!(mode, "whitelist");
        assert_eq!(domains, allowed);
    }

    #[test]
    fn default_action_block_without_an_allow_list_maps_to_block_all() {
        let (mode, domains) = legacy_state_fields("block", &["reddit.com".to_string()], &[]);

        assert_eq!(mode, "block-all");
        assert!(domains.is_empty());
    }

    /// A Smart profile is `defaultAction: "allow"` plus an intent. The old extension cannot judge,
    /// so it must still receive the hard block list rather than an empty frame.
    #[test]
    fn a_smart_profile_still_hands_the_old_extension_its_hard_block_list() {
        let blocked = vec!["news.ycombinator.com".to_string()];
        let (mode, domains) = legacy_state_fields("allow", &blocked, &[]);

        assert_eq!(mode, "blacklist");
        assert_eq!(domains, blocked);
    }

    #[test]
    fn legacy_presets_expand_to_the_current_triple() {
        let domains = vec!["reddit.com".to_string()];

        assert_eq!(
            current_state_fields("blacklist", &domains),
            (domains.clone(), Vec::new(), "allow"),
        );
        assert_eq!(
            current_state_fields("whitelist", &domains),
            (Vec::new(), domains.clone(), "block"),
        );
        assert_eq!(
            current_state_fields("block-all", &domains),
            (Vec::new(), Vec::new(), "block"),
        );
    }

    /// An unset or unrecognized mode must not silently become a default-deny lockout.
    #[test]
    fn an_unknown_mode_falls_back_to_the_open_preset() {
        let (blocked, allowed, default_action) = current_state_fields("", &[]);

        assert!(blocked.is_empty());
        assert!(allowed.is_empty());
        assert_eq!(default_action, "allow");
    }

    /// The two directions must agree, or a daemon and extension one release apart disagree about
    /// what is blocked.
    #[test]
    fn the_two_translations_round_trip() {
        for (mode, domains) in [
            ("blacklist", vec!["reddit.com".to_string()]),
            ("whitelist", vec!["docs.rs".to_string()]),
            ("block-all", Vec::new()),
        ] {
            let (blocked, allowed, default_action) = current_state_fields(mode, &domains);
            assert_eq!(
                legacy_state_fields(default_action, &blocked, &allowed),
                (mode, domains.clone()),
                "round trip failed for {mode}",
            );
        }
    }

    #[test]
    fn oversized_pid_is_rejected_instead_of_truncated() {
        let report = parse_service_heartbeat(&json!({
            "browserPid": u64::from(u32::MAX) + 1,
            "health": { "canBlock": true, "permissionsOk": true },
        }));

        assert_eq!(report.browser_pid, 0);
        assert!(report.healthy);
    }
}
