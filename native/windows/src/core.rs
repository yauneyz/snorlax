//! Authoritative core: holds state + secure store + enforcement handles, dispatches RPCs, and
//! guards the disable path (architecture §4, §9). Wrapped in an async Mutex and shared by every
//! IPC connection.

use std::sync::Arc;

use rand::RngCore;
use serde_json::{json, Value};
use tokio::sync::broadcast;

use crate::constants::{err, PROTOCOL_VERSION, SERVICE_VERSION};
use crate::enforce::{self, EnforceShared};
use crate::model::{
    FocusSource, PairedKey, Policy, Profile, Schedule, ServiceState, MAX_PROFILE_NAME_LENGTH,
};
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
            profiles: self.state.profiles.clone(),
            active_profile_id: self.state.active_profile_id.clone(),
            policy: self.state.active_policy(),
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
        self.emit("stateChanged", json!({ "state": self.snapshot() }));
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

    fn enable_focus(&mut self, source: FocusSource) -> Result<(), RpcError> {
        if self.state.focus_active {
            return Ok(());
        }
        if self.state.paired_keys.is_empty() {
            return Err(RpcError::new(
                err::NO_PAIRED_KEY,
                "Pair a key before turning on focus.",
            ));
        }
        self.set_focus(true, source);
        tracing::info!("focus enabled ({:?})", source);
        Ok(())
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

    /// Re-check USB presence and fail with KEY_REQUIRED when no paired key is plugged in.
    fn require_key(&mut self, message: &str) -> Result<(), RpcError> {
        self.recompute_presence();
        if !self.key_present {
            return Err(RpcError::new(err::KEY_REQUIRED, message));
        }
        Ok(())
    }

    /// Push the active profile's policy into the enforcement layer and announce it. Enforcement
    /// only ever sees this flat, already-resolved policy — it knows nothing about profiles.
    fn apply_active_policy(&mut self) {
        let policy = self.state.active_policy();
        self.shared.set_policy(policy.clone());
        // Policy edits change the resolver target list even while focus is off. Kick a one-shot
        // refresh now so the IP bank is warm before the next session.
        kick_resolver(self.shared.clone());
        self.emit("policyChanged", json!({ "policy": policy }));
    }

    fn emit_profiles(&self) {
        self.emit(
            "profilesChanged",
            json!({
                "profiles": self.state.profiles,
                "activeProfileId": self.state.active_profile_id,
            }),
        );
    }

    /// Edit the **active** profile's policy — the flat shorthand the blocklist editor uses.
    fn set_policy(&mut self, policy: Policy) -> Result<(), RpcError> {
        let mut profile = self.state.active_profile().clone();
        profile.policy = policy;
        self.set_profile(profile)
    }

    /// Create or replace a profile. Tightening is always free. Relaxing — unblocking a site or
    /// app, or a mode change that frees traffic — requires the paired key even when the profile
    /// is not the active one: a locked schedule window may switch to it later, so pre-loosening
    /// a dormant profile has to cost the same as loosening the live one.
    fn set_profile(&mut self, profile: Profile) -> Result<(), RpcError> {
        if profile.id.trim().is_empty() {
            return Err(RpcError::new(err::BAD_REQUEST, "Profile id cannot be empty."));
        }
        let name = profile.name.trim().to_string();
        if name.is_empty() {
            return Err(RpcError::new(
                err::BAD_REQUEST,
                "Profile name cannot be empty.",
            ));
        }
        if name.chars().count() > MAX_PROFILE_NAME_LENGTH {
            return Err(RpcError::new(
                err::BAD_REQUEST,
                format!("Profile names are limited to {MAX_PROFILE_NAME_LENGTH} characters."),
            ));
        }

        let existing = self.state.profiles.iter().position(|p| p.id == profile.id);
        if let Some(idx) = existing {
            let prev = self.state.profiles[idx].policy.clone();
            if !crate::policy_match::is_at_least_as_restrictive(&prev, &profile.policy) {
                self.require_key("Insert your paired key to relax the blocklist.")?;
            }
        }

        let is_active = profile.id == self.state.active_profile_id;
        let profile = Profile { name, ..profile };
        match existing {
            Some(idx) => self.state.profiles[idx] = profile,
            None => self.state.profiles.push(profile),
        }
        self.persist();
        self.emit_profiles();
        if is_active {
            self.apply_active_policy();
        }
        Ok(())
    }

    /// Remove a profile. Key-gated when it is active or a schedule window points at it — both
    /// cases drop enforcement the user had already committed to.
    fn delete_profile(&mut self, profile_id: &str) -> Result<(), RpcError> {
        let Some(idx) = self.state.profiles.iter().position(|p| p.id == profile_id) else {
            return Err(RpcError::new(err::BAD_REQUEST, "Profile not found."));
        };
        if self.state.profiles.len() == 1 {
            return Err(RpcError::new(
                err::LAST_PROFILE,
                "Keep at least one blocking profile.",
            ));
        }

        let is_active = self.state.active_profile_id == profile_id;
        let scheduled = self
            .state
            .schedule
            .windows
            .iter()
            .any(|w| w.profile_id.as_deref() == Some(profile_id));
        if is_active || scheduled {
            if self.schedule_locked() {
                return Err(RpcError::new(
                    err::LOCKED,
                    "A locked schedule window is active.",
                ));
            }
            self.require_key("Insert your paired key to delete this profile.")?;
        }

        self.state.profiles.remove(idx);
        // Windows that pointed at the deleted profile fall back to whatever is active when they
        // fire, rather than silently enforcing nothing.
        for w in &mut self.state.schedule.windows {
            if w.profile_id.as_deref() == Some(profile_id) {
                w.profile_id = None;
            }
        }
        if is_active {
            self.state.active_profile_id = self.state.profiles[0].id.clone();
        }
        self.persist();
        self.emit_profiles();
        if is_active {
            self.apply_active_policy();
        }
        tracing::info!("profile {profile_id} deleted");
        Ok(())
    }

    /// Switch which profile focus enforces. Refused outright inside a locked window. Otherwise
    /// key-gated only when the switch *loosens* what is blocked and something is (or could soon
    /// be) enforcing it — focus on now, or a locked window that will inherit the active profile.
    fn set_active_profile(&mut self, profile_id: &str) -> Result<(), RpcError> {
        let Some(next) = self
            .state
            .profiles
            .iter()
            .find(|p| p.id == profile_id)
            .map(|p| p.policy.clone())
        else {
            return Err(RpcError::new(err::BAD_REQUEST, "Profile not found."));
        };
        if self.state.active_profile_id == profile_id {
            return Ok(());
        }
        if self.schedule_locked() {
            return Err(RpcError::new(
                err::LOCKED,
                "A locked schedule window is active.",
            ));
        }

        let relaxes = !crate::policy_match::is_at_least_as_restrictive(
            &self.state.active_policy(),
            &next,
        );
        let enforcing =
            self.state.focus_active || self.state.schedule.windows.iter().any(|w| w.locked);
        if relaxes && enforcing {
            self.require_key("Insert your paired key to switch to a less restrictive profile.")?;
        }

        self.switch_active_profile(profile_id.to_string());
        Ok(())
    }

    /// Point enforcement at `profile_id` and push the new policy down. Callers gate first.
    fn switch_active_profile(&mut self, profile_id: String) {
        if self.state.active_profile_id == profile_id {
            return;
        }
        self.state.active_profile_id = profile_id;
        self.persist();
        self.emit_profiles();
        self.apply_active_policy();
        tracing::info!("active profile is now {}", self.state.active_profile_id);
    }

    /// Tightening the schedule is always free. Relaxing it — dropping a covered minute, unlocking
    /// a locked one, or repointing a window at a laxer blocking profile — requires the paired key;
    /// with the key present the user may edit any window, including one that is currently active.
    fn set_schedule(&mut self, schedule: Schedule) -> Result<(), RpcError> {
        for w in &schedule.windows {
            if let Some(id) = &w.profile_id {
                if !self.state.profiles.iter().any(|p| p.id == *id) {
                    return Err(RpcError::new(
                        err::BAD_REQUEST,
                        format!("Unknown blocking profile: {id}"),
                    ));
                }
            }
        }
        if !schedule::is_at_least_as_restrictive(
            &self.state.schedule,
            &schedule,
            &self.state.profiles,
            &self.state.active_profile_id,
        ) {
            self.require_key("Insert your paired key to relax the schedule.")?;
        }
        self.state.schedule = schedule;
        self.persist();
        Ok(())
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

        let secret = if drive.serial.is_none() {
            let secret = pairing::generate_secret();
            usb::write_key_file(&drive.mount_point, &secret).map_err(|e| {
                RpcError::new(
                    err::INTERNAL,
                    format!("Drive has no stable identifier and the fallback key file could not be written: {e}"),
                )
            })?;
            Some(pairing::hash_secret(&secret))
        } else {
            None
        };

        let id = format!("key-{}", random_id());
        let label = if label.is_empty() {
            drive.label.clone()
        } else {
            label.to_string()
        };

        self.store.keys.push(KeySecret {
            id: id.clone(),
            secret,
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
        if !self.state.paired_keys.iter().any(|key| key.id == key_id) {
            return Err(RpcError::new(err::BAD_REQUEST, "Paired key not found."));
        }
        if self.state.paired_keys.len() == 1 {
            return Err(RpcError::new(
                err::LAST_PAIRED_KEY,
                "Pair another key before removing your last key.",
            ));
        }
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
        // The active profile may have arrived from a state-file migration; make sure enforcement
        // is holding its policy and not a stale one.
        self.shared.set_policy(self.state.active_policy());
        if self.state.focus_active && self.state.paired_keys.is_empty() {
            tracing::warn!("clearing persisted focus state because no key is paired");
            self.set_focus(false, FocusSource::Boot);
        } else if self.state.focus_active {
            self.shared.set_active(true);
            enforce::apply_network(true);
            kick_resolver(self.shared.clone());
            tracing::info!("re-armed enforcement on boot (focus was active)");
        }
        self.recompute_presence();
    }

    /// Evaluate the schedule and flip focus at window boundaries, switching to the blocking
    /// profile the covering window names. Only auto-disables focus that the schedule itself
    /// turned on (never a user-initiated focus session).
    pub fn schedule_tick(&mut self) {
        let eval = schedule::evaluate_now(&self.state.schedule);
        // A covering window that names a profile switches enforcement to it, even mid-session —
        // this is what "schedule by profile" means. The switch is not key-gated: it is the user's
        // earlier, already-gated decision replaying on time.
        if eval.active {
            if let Some(id) = eval.profile_id.clone() {
                if self.state.profiles.iter().any(|p| p.id == id) {
                    self.switch_active_profile(id);
                }
            }
        }
        if eval.active && !self.state.focus_active && !self.state.paired_keys.is_empty() {
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
                self.enable_focus(FocusSource::User)?;
                Ok(ok())
            }
            "disableFocus" => {
                self.disable_focus(FocusSource::User, false)?;
                Ok(ok())
            }
            "setPolicy" => {
                let policy: Policy = parse_field(params, "policy")?;
                self.set_policy(policy)?;
                Ok(ok())
            }
            "setProfile" => {
                let profile: Profile = parse_field(params, "profile")?;
                self.set_profile(profile)?;
                Ok(ok())
            }
            "deleteProfile" => {
                let profile_id = str_field(params, "profileId")?;
                self.delete_profile(&profile_id)?;
                Ok(ok())
            }
            "setActiveProfile" => {
                let profile_id = str_field(params, "profileId")?;
                self.set_active_profile(&profile_id)?;
                Ok(ok())
            }
            "setSchedule" => {
                let schedule: Schedule = parse_field(params, "schedule")?;
                self.set_schedule(schedule)?;
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
                let healthy = can_block && perms_ok;
                let browser = params.get("browser").and_then(|v| v.as_str()).unwrap_or("");
                let worker_session = params
                    .get("workerSessionId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let sequence = params.get("sequence").and_then(|v| v.as_u64()).unwrap_or(0);
                let sent_at = params.get("sentAt").and_then(|v| v.as_u64()).unwrap_or(0);
                let extension_version = params
                    .get("extensionVersion")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let locked_active = params
                    .get("lockedActive")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                tracing::info!(
                    "extension heartbeat received: browser={browser} pid={pid} worker={worker_session} sequence={sequence} sent_at={sent_at} version={extension_version} locked_active={locked_active} can_block={can_block} permissions_ok={perms_ok} healthy={healthy}"
                );
                if pid != 0 {
                    self.shared.record_heartbeat(pid, healthy);
                } else {
                    tracing::warn!("extension heartbeat ignored: native host reported pid=0");
                }
                Ok(json!({
                    "heartbeat": {
                        "sequence": sequence,
                        "browserPid": pid,
                        "healthy": healthy,
                    }
                }))
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
