//! Temporary compatibility boundary for extension heartbeats.
//!
//! Store review can leave the 0.1.x extension installed after a newer daemon has shipped. Keep the
//! browser-to-daemon translation and tolerant daemon-side parsing here until that rollout window
//! has closed. Removing this module is intentionally mechanical; see `daemon-compatibility-rollback.md`.

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
    fn oversized_pid_is_rejected_instead_of_truncated() {
        let report = parse_service_heartbeat(&json!({
            "browserPid": u64::from(u32::MAX) + 1,
            "health": { "canBlock": true, "permissionsOk": true },
        }));

        assert_eq!(report.browser_pid, 0);
        assert!(report.healthy);
    }
}
