//! Tolerant parsing at the heartbeat boundary. Optional diagnostics may be absent, but malformed
//! health data always fails closed. Blocking state itself has one canonical protocol-v4 shape.

use serde_json::{json, Value};

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeartbeatReport {
    pub browser_pid: u32,
    pub browser: String,
    pub sequence: u64,
    pub extension_version: Option<String>,
    pub healthy: bool,
}

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

    #[test]
    fn relay_preserves_current_heartbeat_metadata() {
        let frame = json!({
            "browser": "chrome",
            "workerSessionId": "worker",
            "sequence": 17,
            "sentAt": 1722470400000_u64,
            "extensionVersion": "0.5.0",
            "lockedActive": true,
            "health": { "canBlock": true, "permissionsOk": true, "dnrRulesApplied": 3 }
        });
        let params = relay_heartbeat_params(&frame, 4242);
        let report = parse_service_heartbeat(&params);
        assert_eq!(report.browser_pid, 4242);
        assert_eq!(report.sequence, 17);
        assert_eq!(report.extension_version.as_deref(), Some("0.5.0"));
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
            assert!(
                !parse_service_heartbeat(&json!({ "browserPid": 9, "health": health })).healthy
            );
        }
    }
}
