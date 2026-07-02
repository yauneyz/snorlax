//! Authoritative core: holds state + secure store + enforcement handles, dispatches RPCs, and
//! guards the disable path (architecture §4, §9). Wrapped in an async Mutex and shared by every
//! IPC connection.

use std::sync::Arc;

use rand::RngCore;
use serde_json::{json, Value};
use tokio::sync::broadcast;

use crate::constants::{err, PROTOCOL_VERSION, SERVICE_VERSION};
use crate::enforce::{self, EnforceShared};
use crate::model::{FocusSource, PairedKey, Policy, Schedule, ServiceState};
use crate::pairing;
use crate::schedule;
use crate::secure_store::{KeySecret, SecureStore};
use crate::state::PersistentState;
use crate::usb;

/// An RPC error mapped to the wire `{ ok:false, code, message }`.
pub struct RpcError {
    pub code: String,
    pub message: String,
}

impl RpcError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        RpcError {
            code: code.into(),
            message: message.into(),
        }
    }
}

pub struct Core {
    pub state: PersistentState,
    pub store: SecureStore,
    pub shared: Arc<EnforceShared>,
    pub key_present: bool,
    pub present_key_id: Option<String>,
    pub events: broadcast::Sender<Value>,
}

impl Core {
    pub fn new(state: PersistentState, store: SecureStore, shared: Arc<EnforceShared>) -> Self {
        let (events, _) = broadcast::channel(64);
        Core {
            state,
            store,
            shared,
            key_present: false,
            present_key_id: None,
            events,
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Value> {
        self.events.subscribe()
    }

    fn emit(&self, event: &str, payload: Value) {
        let _ = self
            .events
            .send(json!({ "kind": "event", "event": event, "payload": payload }));
    }

    fn schedule_locked(&self) -> bool {
        let e = schedule::evaluate_now(&self.state.schedule);
        e.active && e.locked
    }

    pub fn snapshot(&self) -> ServiceState {
        ServiceState {
            protocol_version: PROTOCOL_VERSION,
            service_version: SERVICE_VERSION.to_string(),
            focus_active: self.state.focus_active,
            focus_source: self.state.focus_source,
            policy: self.state.policy.clone(),
            schedule: self.state.schedule.clone(),
            settings: self.state.settings.clone(),
            paired_keys: self.state.paired_keys.clone(),
            key_present: self.key_present,
            present_key_id: self.present_key_id.clone(),
            schedule_locked: self.schedule_locked(),
        }
    }

    fn persist(&self) {
        if let Err(e) = self.state.save() {
            tracing::error!("state save failed: {e}");
        }
        if let Err(e) = self.store.save() {
            tracing::error!("secure store save failed: {e}");
        }
    }

    /// Re-enumerate USB and update the cached presence; emits keyPresenceChanged on a change.
    pub fn recompute_presence(&mut self) {
        let ids = usb::present_key_ids(&self.store);
        let present = !ids.is_empty();
        let present_id = ids.into_iter().next();
        if present != self.key_present || present_id != self.present_key_id {
            self.key_present = present;
            self.present_key_id = present_id.clone();
            self.emit(
                "keyPresenceChanged",
                json!({ "present": present, "keyId": present_id }),
            );
        }
    }

    fn set_focus(&mut self, active: bool, source: FocusSource) {
        self.state.focus_active = active;
        self.state.focus_source = source;
        if active {
            // Keep the resolver-fed IP bank intact across sessions. Focus-on just opens the
            // network gates over the already-warm set, then kicks a refresh for freshness.
            self.shared.set_active(true);
            enforce::apply_network(true);
            kick_resolver(self.shared.clone());
        } else {
            self.shared.set_active(false);
            enforce::apply_network(false);
        }
        self.persist();
        self.emit(
            "focusChanged",
            json!({ "active": active, "source": source }),
        );
    }

    fn enable_focus(&mut self, source: FocusSource) {
        if self.state.focus_active {
            return;
        }
        self.set_focus(true, source);
        tracing::info!("focus enabled ({:?})", source);
    }

    /// The guarded disable path. `bypass` is only set by the recovery killswitch.
    fn disable_focus(&mut self, source: FocusSource, bypass: bool) -> Result<(), RpcError> {
        if !bypass {
            if self.schedule_locked() {
                return Err(RpcError::new(
                    err::LOCKED,
                    "A locked schedule window is active.",
                ));
            }
            self.recompute_presence();
            if !self.key_present {
                return Err(RpcError::new(
                    err::KEY_REQUIRED,
                    "Insert your paired key to unlock.",
                ));
            }
        }
        self.set_focus(false, source);
        tracing::info!("focus disabled ({:?}, bypass={bypass})", source);
        Ok(())
    }

    fn set_policy(&mut self, policy: Policy) {
        self.state.policy = policy.clone();
        self.shared.set_policy(policy.clone());
        // Policy edits change the resolver target list even while focus is off. Kick a one-shot
        // refresh now so the IP bank is warm before the next session.
        kick_resolver(self.shared.clone());
        self.persist();
        self.emit("policyChanged", json!({ "policy": policy }));
    }

    fn set_schedule(&mut self, schedule: Schedule) {
        self.state.schedule = schedule;
        self.persist();
    }

    /// Toggle the browser handshake dead-man's switch. Enabling is free; **disabling** is gated
    /// exactly like `disable_focus` (USB key + no locked window), so a user mid-session cannot
    /// simply switch enforcement off.
    fn set_browser_handshake(&mut self, enabled: bool) -> Result<(), RpcError> {
        if !enabled {
            if self.schedule_locked() {
                return Err(RpcError::new(
                    err::LOCKED,
                    "A locked schedule window is active.",
                ));
            }
            self.recompute_presence();
            if !self.key_present {
                return Err(RpcError::new(
                    err::KEY_REQUIRED,
                    "Insert your paired key to change this setting.",
                ));
            }
        }
        self.state.settings.browser_handshake_enabled = enabled;
        self.shared.set_handshake_enabled(enabled);
        self.persist();
        self.emit(
            "settingsChanged",
            json!({ "settings": self.state.settings.clone() }),
        );
        tracing::info!("browser handshake set to {enabled}");
        Ok(())
    }

    fn pair_key(&mut self, drive_id: &str, label: &str) -> Result<PairedKey, RpcError> {
        let drives = usb::list_removable_drives();
        let drive = drives
            .into_iter()
            .find(|d| d.id == drive_id)
            .ok_or_else(|| {
                RpcError::new(err::BAD_REQUEST, "Drive not found or no longer connected.")
            })?;

        let secret = pairing::generate_secret();
        usb::write_key_file(&drive.mount_point, &secret)
            .map_err(|e| RpcError::new(err::INTERNAL, format!("Could not write key file: {e}")))?;

        let id = format!("key-{}", random_id());
        let label = if label.is_empty() {
            drive.label.clone()
        } else {
            label.to_string()
        };

        self.store.keys.push(KeySecret {
            id: id.clone(),
            secret: pairing::hash_secret(&secret),
            volume_serial: drive.serial.clone(),
        });

        let key = PairedKey {
            id: id.clone(),
            label,
            serial_ambiguous: drive.serial_ambiguous,
            paired_at: now_ms(),
        };
        self.state.paired_keys.push(key.clone());
        self.persist();
        self.recompute_presence();
        Ok(key)
    }

    fn unpair_key(&mut self, key_id: &str) -> Result<(), RpcError> {
        // Removing a key is itself key-gated (architecture §6).
        self.recompute_presence();
        if !self.key_present {
            return Err(RpcError::new(
                err::KEY_REQUIRED,
                "Insert a paired key to remove a key.",
            ));
        }
        self.state.paired_keys.retain(|k| k.id != key_id);
        self.store.remove_key(key_id);
        self.persist();
        self.recompute_presence();
        Ok(())
    }

    fn recover(&mut self, code: &str) -> Result<(), RpcError> {
        let Some(stored) = &self.store.recovery else {
            return Err(RpcError::new(
                err::BAD_RECOVERY_CODE,
                "No recovery code is configured.",
            ));
        };
        if !pairing::verify_recovery_code(code, stored) {
            return Err(RpcError::new(
                err::BAD_RECOVERY_CODE,
                "Recovery code did not match.",
            ));
        }
        tracing::warn!("recovery code accepted — force-disabling focus");
        // Bypass the USB + locked gates entirely.
        self.disable_focus(FocusSource::Recover, true)
    }

    /// Re-arm enforcement at boot for whatever focus state we loaded from disk.
    pub fn rearm_on_boot(&mut self) {
        // Restore the persisted handshake setting into the shared enforcement state.
        self.shared
            .set_handshake_enabled(self.state.settings.browser_handshake_enabled);
        if self.state.focus_active {
            self.shared.set_active(true);
            enforce::apply_network(true);
            kick_resolver(self.shared.clone());
            tracing::info!("re-armed enforcement on boot (focus was active)");
        }
        self.recompute_presence();
    }

    /// Evaluate the schedule and flip focus at window boundaries. Only auto-disables focus that
    /// the schedule itself turned on (never a user-initiated focus session).
    pub fn schedule_tick(&mut self) {
        let eval = schedule::evaluate_now(&self.state.schedule);
        if eval.active && !self.state.focus_active {
            self.set_focus(true, FocusSource::Schedule);
            if let Some(id) = eval.window_id {
                self.emit("scheduleFired", json!({ "windowId": id, "active": true }));
            }
        } else if !eval.active
            && self.state.focus_active
            && self.state.focus_source == FocusSource::Schedule
        {
            self.set_focus(false, FocusSource::Schedule);
            self.emit("scheduleFired", json!({ "windowId": "", "active": false }));
        }
    }

    /// Dispatch a parsed request. Returns the JSON `result` on success.
    pub fn dispatch(&mut self, method: &str, params: &Value) -> Result<Value, RpcError> {
        match method {
            "getState" => Ok(serde_json::to_value(self.snapshot()).unwrap()),
            "ping" => {
                Ok(json!({ "version": SERVICE_VERSION, "protocolVersion": PROTOCOL_VERSION }))
            }
            "getKeyPresence" => {
                Ok(json!({ "present": self.key_present, "keyId": self.present_key_id }))
            }
            "enableFocus" => {
                self.enable_focus(FocusSource::User);
                Ok(ok())
            }
            "disableFocus" => {
                self.disable_focus(FocusSource::User, false)?;
                Ok(ok())
            }
            "setPolicy" => {
                let policy: Policy = parse_field(params, "policy")?;
                self.set_policy(policy);
                Ok(ok())
            }
            "setSchedule" => {
                let schedule: Schedule = parse_field(params, "schedule")?;
                self.set_schedule(schedule);
                Ok(ok())
            }
            "setBrowserHandshake" => {
                let enabled = params
                    .get("enabled")
                    .and_then(|v| v.as_bool())
                    .ok_or_else(|| RpcError::new(err::BAD_REQUEST, "Missing field: enabled"))?;
                self.set_browser_handshake(enabled)?;
                Ok(ok())
            }
            "extHeartbeat" => {
                // Fire-and-forget liveness from the extension (relayed by talysman-natmsg). Record
                // it for the watchdog; never errors so a malformed beat can't disrupt the bridge.
                let pid = params
                    .get("browserPid")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as u32;
                let health = params.get("health");
                let can_block = health
                    .and_then(|h| h.get("canBlock"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let perms_ok = health
                    .and_then(|h| h.get("permissionsOk"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if pid != 0 {
                    self.shared.record_heartbeat(pid, can_block && perms_ok);
                }
                Ok(ok())
            }
            "listRemovableDrives" => {
                let drives: Vec<Value> = usb::list_removable_drives()
                    .into_iter()
                    .map(|d| {
                        json!({
                            "id": d.id,
                            "label": d.label,
                            "mountPoint": d.mount_point,
                            "serial": d.serial,
                            "serialAmbiguous": d.serial_ambiguous,
                        })
                    })
                    .collect();
                Ok(json!({ "drives": drives }))
            }
            "pairKey" => {
                let drive_id = str_field(params, "driveId")?;
                let label = params.get("label").and_then(|v| v.as_str()).unwrap_or("");
                let key = self.pair_key(&drive_id, label)?;
                Ok(json!({ "key": serde_json::to_value(key).unwrap() }))
            }
            "unpairKey" => {
                let key_id = str_field(params, "keyId")?;
                self.unpair_key(&key_id)?;
                Ok(ok())
            }
            "recover" => {
                let code = str_field(params, "code")?;
                self.recover(&code)?;
                Ok(ok())
            }
            other => Err(RpcError::new(
                err::BAD_REQUEST,
                format!("Unknown method: {other}"),
            )),
        }
    }
}

/// Fire a one-shot background resolve of the current policy's domains (focus-on / policy-change /
/// boot). Runs on a detached thread because `resolve_and_ingest` blocks on UDP. The resolver runs
/// regardless of focus so the next session starts with a warm IP bank.
fn kick_resolver(shared: Arc<EnforceShared>) {
    std::thread::spawn(move || crate::enforce::resolve::resolve_and_ingest(&shared));
}

fn ok() -> Value {
    json!({ "ok": true })
}

fn parse_field<T: serde::de::DeserializeOwned>(params: &Value, field: &str) -> Result<T, RpcError> {
    let v = params
        .get(field)
        .ok_or_else(|| RpcError::new(err::BAD_REQUEST, format!("Missing field: {field}")))?;
    serde_json::from_value(v.clone())
        .map_err(|e| RpcError::new(err::BAD_REQUEST, format!("Bad {field}: {e}")))
}

fn str_field(params: &Value, field: &str) -> Result<String, RpcError> {
    params
        .get(field)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| RpcError::new(err::BAD_REQUEST, format!("Missing string field: {field}")))
}

fn random_id() -> String {
    let mut b = [0u8; 8];
    rand::thread_rng().fill_bytes(&mut b);
    hex::encode(b)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
