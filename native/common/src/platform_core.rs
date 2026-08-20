// Shared authoritative core: holds state + secure store + enforcement handles, dispatches RPCs,
// and guards the disable path. Wrapped in an async Mutex and shared by every IPC connection.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use rand::RngCore;
use serde_json::{json, Value};
use tokio::sync::broadcast;

use crate::constants::{err, PROTOCOL_VERSION, SERVICE_VERSION};
use crate::enforce::{self, EnforceShared};
use crate::model::{
    DefaultAction, FocusSource, PairedKey, Policy, Profile, Schedule, ServiceState, TransitionKind,
    MAX_PROFILE_NAME_LENGTH,
};
use crate::pairing;
use crate::schedule;
use crate::secure_store::{KeySecret, SecureStore};
use crate::state::PersistentState;
use crate::usb;

/// The extension waits 12 seconds, leaving room for this authoritative fallback to arrive first.
const JUDGE_TIMEOUT: Duration = Duration::from_secs(8);

/// A `judgeRequest` awaiting `submitJudgeVerdict`. `default_action` is captured from the
/// requesting profile at request time so the timeout sweep can answer fail-closed/fail-open
/// without having to guess which profile (possibly since switched away from) asked.
#[derive(Clone)]
struct PendingJudge {
    requested_at: Instant,
    url: String,
    default_action: DefaultAction,
    intent: crate::model::Intent,
}

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
    extension_event_at: HashMap<u32, Instant>,
    /// Judge requests relayed to Electron via `judgeRequested`, awaiting `submitJudgeVerdict`.
    /// Swept on a timer (see `sweep_expired_judges`) so a request is always eventually answered.
    pending_judges: HashMap<String, PendingJudge>,
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
            extension_event_at: HashMap::new(),
            pending_judges: HashMap::new(),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Value> {
        self.events.subscribe()
    }

    pub fn has_paired_keys(&self) -> bool {
        !self.state.paired_keys.is_empty()
    }

    pub fn next_schedule_delay(&self) -> Duration {
        schedule::next_transition_delay(&self.state.schedule)
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

    fn persist_state(&self) {
        if let Err(e) = self.state.save() {
            tracing::error!("state save failed: {e}");
        }
        self.emit("stateChanged", json!({ "state": self.snapshot() }));
    }

    fn persist_all(&self) {
        if let Err(e) = self.state.save() {
            tracing::error!("state save failed: {e}");
        }
        if let Err(e) = self.store.save() {
            tracing::error!("secure store save failed: {e}");
        }
        self.emit("stateChanged", json!({ "state": self.snapshot() }));
    }

    /// Append one entry to the exact-usage transition log (architecture §7/Phase 7). Does not
    /// save on its own — callers already persist state on their own cadence (`set_focus` calls
    /// `persist_state()` right after; a presence-only change rides along on the next save
    /// triggered elsewhere, which is an accepted tradeoff since the log only feeds `drainUsage`).
    fn record_transition(&mut self, kind: TransitionKind, source: FocusSource) {
        self.state.push_transition(kind, source);
    }

    /// Re-enumerate USB and update the cached presence; emits keyPresenceChanged on a change.
    pub fn recompute_presence(&mut self) {
        let ids = usb::present_key_ids(&self.store);
        let present = !ids.is_empty();
        let present_id = ids.into_iter().next();
        if present != self.key_present || present_id != self.present_key_id {
            self.key_present = present;
            self.present_key_id = present_id.clone();
            self.record_transition(
                if present {
                    TransitionKind::KeyPresent
                } else {
                    TransitionKind::KeyAbsent
                },
                FocusSource::Boot,
            );
            self.emit(
                "keyPresenceChanged",
                json!({ "present": present, "keyId": present_id }),
            );
        }
    }

    fn set_focus(&mut self, active: bool, source: FocusSource) {
        self.pending_judges.clear();
        self.state.focus_active = active;
        self.state.focus_source = source;
        if active {
            // Keep the resolver-fed IP bank intact across sessions. Focus-on just opens the
            // network gates over the already-warm set, then kicks a refresh for freshness.
            self.shared.set_active(true);
            enforce::apply_network(true);
        } else {
            self.shared.set_active(false);
            enforce::apply_network(false);
        }
        self.record_transition(
            if active {
                TransitionKind::FocusOn
            } else {
                TransitionKind::FocusOff
            },
            source,
        );
        self.persist_state();
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

    /// The guarded disable path.
    fn disable_focus(&mut self, source: FocusSource) -> Result<(), RpcError> {
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
        self.set_focus(false, source);
        tracing::info!("focus disabled ({:?})", source);
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
        self.pending_judges.clear();
        let policy = self.state.active_policy();
        self.shared.set_policy(policy.clone());
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
            return Err(RpcError::new(
                err::BAD_REQUEST,
                "Profile id cannot be empty.",
            ));
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
        let profile = Profile { name, ..profile };
        if existing.is_some_and(|idx| self.state.profiles[idx] == profile) {
            return Ok(());
        }
        if let Some(idx) = existing {
            let prev = self.state.profiles[idx].policy.clone();
            if !crate::policy_match::is_at_least_as_restrictive(&prev, &profile.policy) {
                self.require_key("Insert your paired key to relax the blocklist.")?;
            }
        }

        let is_active = profile.id == self.state.active_profile_id;
        match existing {
            Some(idx) => self.state.profiles[idx] = profile,
            None => self.state.profiles.push(profile),
        }
        self.persist_state();
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
        self.persist_state();
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

        let relaxes =
            !crate::policy_match::is_at_least_as_restrictive(&self.state.active_policy(), &next);
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
        self.persist_state();
        self.emit_profiles();
        self.apply_active_policy();
        tracing::info!("active profile is now {}", self.state.active_profile_id);
    }

    /// Tightening the schedule is always free. Relaxing it — dropping a covered minute, unlocking
    /// a locked one, or repointing a window at a laxer blocking profile — requires the paired key;
    /// with the key present the user may edit any window, including one that is currently active.
    fn set_schedule(&mut self, schedule: Schedule) -> Result<(), RpcError> {
        if self.state.schedule == schedule {
            return Ok(());
        }
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
        self.persist_state();
        Ok(())
    }

    /// Toggle the browser handshake dead-man's switch. Enabling is free; **disabling** is gated
    /// exactly like `disable_focus` (USB key + no locked window), so a user mid-session cannot
    /// simply switch enforcement off.
    fn set_browser_handshake(&mut self, enabled: bool) -> Result<(), RpcError> {
        if self.state.settings.browser_handshake_enabled == enabled {
            return Ok(());
        }
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
        self.persist_state();
        self.emit(
            "settingsChanged",
            json!({ "settings": self.state.settings.clone() }),
        );
        tracing::info!("browser handshake set to {enabled}");
        Ok(())
    }

    /// Toggle the tray helper's icon. Purely cosmetic (not a security boundary) — unlike
    /// `set_browser_handshake`, never gated.
    fn set_tray_icon_enabled(&mut self, enabled: bool) {
        if self.state.settings.tray_icon_enabled == enabled {
            return;
        }
        self.state.settings.tray_icon_enabled = enabled;
        self.persist_state();
        self.emit(
            "settingsChanged",
            json!({ "settings": self.state.settings.clone() }),
        );
    }

    fn set_smart_filtering_enabled(&mut self, enabled: bool) {
        if self.state.settings.smart_filtering_enabled == enabled {
            return;
        }
        self.pending_judges.clear();
        self.state.settings.smart_filtering_enabled = enabled;
        self.persist_state();
        self.emit(
            "settingsChanged",
            json!({ "settings": self.state.settings.clone() }),
        );
    }

    /// Extension (via natmsg) → service: a page under an `intent`-enabled profile fell through
    /// both hard lists. Record it as pending and broadcast `judgeRequested` for Electron to pick
    /// up; the real answer comes back later as `submitJudgeVerdict` (or the timeout sweep).
    /// Fire-and-forget from the RPC caller's perspective; malformed/overloaded requests are refused.
    fn judge_request(
        &mut self,
        request_id: String,
        url: String,
        extracted_text: String,
    ) -> Result<(), RpcError> {
        if request_id.is_empty()
            || request_id.len() > 128
            || url.len() > 4096
            || extracted_text.len() > 4000
        {
            return Err(RpcError::new(
                err::BAD_REQUEST,
                "Invalid judge request size.",
            ));
        }
        if self.pending_judges.contains_key(&request_id) {
            return Err(RpcError::new(
                err::BAD_REQUEST,
                "Duplicate judge request id.",
            ));
        }
        if self.pending_judges.len() >= 128 {
            return Err(RpcError::new(
                err::BAD_REQUEST,
                "Too many pending judge requests.",
            ));
        }
        let policy = self.state.active_policy();
        let default_action = policy.default_action;
        if !self.state.settings.smart_filtering_enabled {
            self.emit(
                "judgeResult",
                json!({
                    "requestId": request_id,
                    "url": url,
                    "relevant": default_action == DefaultAction::Allow,
                    "reason": "Classic filtering is active"
                }),
            );
            return Ok(());
        }
        let Some(intent) = policy.intent else {
            // A stale extension request after focus/profile changed must not wake Electron or sit
            // pending. Answer immediately using the canonical classic fallback.
            self.emit(
                "judgeResult",
                json!({
                    "requestId": request_id,
                    "url": url,
                    "relevant": default_action == DefaultAction::Allow,
                    "reason": "Smart filtering is not active"
                }),
            );
            return Ok(());
        };
        if !self.state.focus_active {
            self.emit(
                "judgeResult",
                json!({ "requestId": request_id, "url": url, "relevant": true, "reason": "Focus is off" }),
            );
            return Ok(());
        }
        self.pending_judges.insert(
            request_id.clone(),
            PendingJudge {
                requested_at: Instant::now(),
                url: url.clone(),
                default_action,
                intent: intent.clone(),
            },
        );
        self.emit(
            "judgeRequested",
            json!({
                "requestId": request_id,
                "url": url,
                "extractedText": extracted_text,
                "intent": intent
            }),
        );
        Ok(())
    }

    /// Electron main → service: the verdict for a pending `judgeRequested`. Unknown/already-
    /// resolved `requestId`s are ignored — either the timeout sweep already answered fail-closed,
    /// or this is a stale/duplicate report — so the extension is never answered twice.
    fn submit_judge_verdict(&mut self, request_id: &str, relevant: bool, reason: String) {
        let Some(pending) = self.pending_judges.remove(request_id) else {
            return;
        };
        // Discard a paid verdict if the policy changed while it was in flight. The extension also
        // invalidates its request on every state generation, so emitting here would only be stale.
        if !self.state.focus_active
            || self.state.active_policy().intent.as_ref() != Some(&pending.intent)
        {
            return;
        }
        self.emit(
            "judgeResult",
            json!({ "requestId": request_id, "url": pending.url, "relevant": relevant, "reason": reason }),
        );
    }

    /// Answer every `judgeRequest` that has been pending longer than `JUDGE_TIMEOUT` with the
    /// requesting profile's `defaultAction` fallback (`allow` -> relevant, `block` -> not
    /// relevant), so a judge that never reports back (Electron not running, no auth session, the
    /// web call failing) never leaves the extension hanging indefinitely. Called on a timer from
    /// `service.rs`, independent of focus/monitoring state, so it always runs.
    pub fn sweep_expired_judges(&mut self) {
        let now = Instant::now();
        let mut expired: Vec<(String, PendingJudge)> = Vec::new();
        self.pending_judges.retain(|request_id, pending| {
            if now.duration_since(pending.requested_at) >= JUDGE_TIMEOUT {
                expired.push((request_id.clone(), pending.clone()));
                false
            } else {
                true
            }
        });
        for (request_id, pending) in expired {
            tracing::warn!(
                "judge request {request_id} timed out; answering with defaultAction fallback"
            );
            self.emit(
                "judgeResult",
                json!({
                    "requestId": request_id,
                    "url": pending.url,
                    "relevant": pending.default_action == DefaultAction::Allow,
                    "reason": "judge unavailable",
                }),
            );
        }
    }

    /// Sleep exactly until the oldest pending judge expires. `None` lets the service task stay
    /// parked on the event channel when Smart filtering is idle (the common production case).
    pub fn next_judge_delay(&self) -> Option<Duration> {
        self.pending_judges
            .values()
            .map(|pending| JUDGE_TIMEOUT.saturating_sub(pending.requested_at.elapsed()))
            .min()
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
        self.persist_all();
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
        self.persist_all();
        self.recompute_presence();
        Ok(())
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
                self.record_transition(TransitionKind::ScheduleFired, FocusSource::Schedule);
                self.emit("scheduleFired", json!({ "windowId": id, "active": true }));
            }
        } else if !eval.active
            && self.state.focus_active
            && self.state.focus_source == FocusSource::Schedule
        {
            self.set_focus(false, FocusSource::Schedule);
            self.record_transition(TransitionKind::ScheduleFired, FocusSource::Schedule);
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
                self.disable_focus(FocusSource::User)?;
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
            "setTrayIconEnabled" => {
                let enabled = params
                    .get("enabled")
                    .and_then(|v| v.as_bool())
                    .ok_or_else(|| RpcError::new(err::BAD_REQUEST, "Missing field: enabled"))?;
                self.set_tray_icon_enabled(enabled);
                Ok(ok())
            }
            "setSmartFilteringEnabled" => {
                let enabled = params
                    .get("enabled")
                    .and_then(|v| v.as_bool())
                    .ok_or_else(|| RpcError::new(err::BAD_REQUEST, "Missing field: enabled"))?;
                self.set_smart_filtering_enabled(enabled);
                Ok(ok())
            }
            "extHeartbeat" => {
                // Fire-and-forget liveness from the extension (relayed by talysman-natmsg). Record
                // it for the watchdog; never errors so a malformed beat can't disrupt the bridge.
                let heartbeat = talysman_common::extension_compat::parse_service_heartbeat(params);
                let pid = heartbeat.browser_pid;
                let healthy = heartbeat.healthy;
                let browser = heartbeat.browser.as_str();
                let sequence = heartbeat.sequence;
                let extension_version = heartbeat.extension_version.as_deref().unwrap_or("");
                if pid != 0 {
                    let changed = self.shared.record_heartbeat(pid, healthy);
                    let now = Instant::now();
                    let due = self.extension_event_at.get(&pid).map_or(true, |last| {
                        now.duration_since(*last) >= Duration::from_secs(30)
                    });
                    if changed || due {
                        self.extension_event_at.insert(pid, now);
                        self.emit(
                            "extensionHeartbeat",
                            json!({
                                "browser": browser,
                                "pid": pid,
                                "extensionVersion": if extension_version.is_empty() {
                                    Value::Null
                                } else {
                                    Value::String(extension_version.to_string())
                                },
                                "healthy": healthy,
                            }),
                        );
                    }
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
            "drainUsage" => {
                let after_seq = params
                    .get("afterSeq")
                    .and_then(|v| v.as_u64())
                    .ok_or_else(|| RpcError::new(err::BAD_REQUEST, "Missing field: afterSeq"))?;
                let transitions: Vec<Value> = self
                    .state
                    .usage_log
                    .iter()
                    .filter(|t| t.seq > after_seq)
                    .map(|t| serde_json::to_value(t).unwrap())
                    .collect();
                Ok(json!({ "transitions": transitions, "latestSeq": self.state.usage_seq }))
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
            "judgeRequest" => {
                let request_id = str_field(params, "requestId")?;
                let url = str_field(params, "url")?;
                let extracted_text = str_field(params, "extractedText")?;
                self.judge_request(request_id, url, extracted_text)?;
                Ok(ok())
            }
            "submitJudgeVerdict" => {
                let request_id = str_field(params, "requestId")?;
                let relevant = params
                    .get("relevant")
                    .and_then(|v| v.as_bool())
                    .ok_or_else(|| RpcError::new(err::BAD_REQUEST, "Missing field: relevant"))?;
                let reason = str_field(params, "reason")?;
                self.submit_judge_verdict(&request_id, relevant, reason);
                Ok(ok())
            }
            other => Err(RpcError::new(
                err::BAD_REQUEST,
                format!("Unknown method: {other}"),
            )),
        }
    }
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
    b.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
