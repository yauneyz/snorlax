// Shared authoritative core: holds state + secure store + enforcement handles, dispatches RPCs,
// and guards every key-gated path. Wrapped in an async Mutex and shared by every IPC connection.
//
// All decisions about profiles, schedules, overrides, pools, emergency unlocks and the streak are
// made by `talysman_engine::Engine`; this shell supplies the clock, verifies the USB key when the
// engine asks for one (`Gate::NeedsKey`), persists state, and pushes the engine's effective policy
// into the platform enforcers as one flat network policy.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use rand::RngCore;
use serde_json::{json, Value};
use talysman_engine::engine::{Command, Gate, PopupTarget};
use talysman_engine::{Auth, Ctx, Engine, EngineError, Tick};
use tokio::sync::broadcast;

use crate::constants::{err, PROTOCOL_VERSION, SERVICE_VERSION};
use crate::enforce::{self, EnforceShared};
use crate::model::{DefaultAction, FocusSource, PairedKey, Policy, ServiceState, TransitionKind};
use crate::pairing;
use crate::secure_store::{KeySecret, SecureStore};
use crate::state::{local_now, PersistentState};
use crate::usb;

/// The extension waits 12 seconds, leaving room for this authoritative fallback to arrive first.
const JUDGE_TIMEOUT: Duration = Duration::from_secs(8);

/// Bounds on `judgeRequest` params; mirrors `JUDGE_LIMITS` in packages/shared/src/judge.ts.
const JUDGE_MAX_REQUEST_ID: usize = 128;
const JUDGE_MAX_URL: usize = 4096;
const JUDGE_MAX_TITLE: usize = 300;
const JUDGE_MAX_CONTENT: usize = 4000;

/// The engine never wants to sleep longer than an hour; clamp anyway so a clock jump can't
/// park the schedule task for days.
const MAX_TICK_DELAY: Duration = Duration::from_secs(60 * 60);

/// A `judgeRequest` awaiting `submitJudgeVerdict`. The judge policy is captured at request time
/// so the timeout sweep answers with the requesting profile's fallback, and so a verdict computed
/// against since-edited tasks is discarded.
#[derive(Clone)]
struct PendingJudge {
    requested_at: Instant,
    url: String,
    judge: crate::model::JudgePolicy,
}

fn verdict_for(action: DefaultAction) -> &'static str {
    match action {
        DefaultAction::Allow => "allow",
        DefaultAction::Block => "block",
    }
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

impl From<EngineError> for RpcError {
    fn from(e: EngineError) -> Self {
        RpcError { code: e.code, message: e.message }
    }
}

pub struct Core {
    pub state: PersistentState,
    pub engine: Engine,
    pub store: SecureStore,
    pub shared: Arc<EnforceShared>,
    pub key_present: bool,
    pub present_key_id: Option<String>,
    pub events: broadcast::Sender<Value>,
    extension_event_at: HashMap<u32, Instant>,
    /// Judge requests relayed to Electron via `judgeRequested`, awaiting `submitJudgeVerdict`.
    /// Swept on a timer (see `sweep_expired_judges`) so a request is always eventually answered.
    pending_judges: HashMap<String, PendingJudge>,
    /// The flat policy last pushed to the enforcers (and reported as `ServiceState.policy`).
    network_policy: Policy,
    /// Whether any profile was enforced at the last effective-policy push.
    active: bool,
    focus_source: FocusSource,
    /// Tests stand in for USB enumeration with this.
    #[cfg(test)]
    pub test_present_key: Option<String>,
}

impl Core {
    pub fn new(mut state: PersistentState, store: SecureStore, shared: Arc<EnforceShared>) -> Self {
        let (events, _) = broadcast::channel(64);
        let engine = Engine::new(state.engine_state());
        state.engine = None;
        Core {
            state,
            engine,
            store,
            shared,
            key_present: false,
            present_key_id: None,
            events,
            extension_event_at: HashMap::new(),
            pending_judges: HashMap::new(),
            network_policy: Policy::default(),
            active: false,
            focus_source: FocusSource::Boot,
            #[cfg(test)]
            test_present_key: None,
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Value> {
        self.events.subscribe()
    }

    pub fn has_paired_keys(&self) -> bool {
        !self.state.paired_keys.is_empty()
    }

    fn ctx(&self) -> Ctx {
        Ctx {
            now: local_now(),
            has_paired_keys: self.has_paired_keys(),
            limits: Default::default(),
        }
    }

    pub fn focus_active(&self) -> bool {
        self.active
    }

    fn emit(&self, event: &str, payload: Value) {
        let _ = self
            .events
            .send(json!({ "kind": "event", "event": event, "payload": payload }));
    }

    pub fn snapshot(&self) -> ServiceState {
        let ctx = self.ctx();
        let engine = self.engine.snapshot(&ctx);
        ServiceState {
            protocol_version: PROTOCOL_VERSION,
            service_version: SERVICE_VERSION.to_string(),
            focus_active: self.active,
            focus_source: self.focus_source,
            policy: self.network_policy.clone(),
            schedule_locked: engine
                .profiles
                .iter()
                .any(|p| p.activation.active && p.activation.locked_until_ms.is_some()),
            engine,
            settings: self.state.settings.clone(),
            paired_keys: self.state.paired_keys.clone(),
            key_present: self.key_present,
            present_key_id: self.present_key_id.clone(),
        }
    }

    fn save(&mut self) {
        self.state.engine = Some(self.engine.state.clone());
        if let Err(e) = self.state.save() {
            tracing::error!("state save failed: {e}");
        }
        self.state.engine = None;
    }

    fn persist_state(&mut self) {
        self.save();
        self.emit("stateChanged", json!({ "state": self.snapshot() }));
    }

    fn persist_all(&mut self) {
        self.save();
        if let Err(e) = self.store.save() {
            tracing::error!("secure store save failed: {e}");
        }
        self.emit("stateChanged", json!({ "state": self.snapshot() }));
    }

    /// Append one entry to the exact-usage transition log (architecture §7/Phase 7). Does not
    /// save on its own — every caller persists right after.
    fn record_transition(&mut self, kind: TransitionKind, source: FocusSource) {
        self.state.push_transition(kind, source);
    }

    /// Re-enumerate USB and update the cached presence; emits keyPresenceChanged on a change.
    pub fn recompute_presence(&mut self) {
        #[cfg(test)]
        let ids: Vec<String> = self.test_present_key.clone().into_iter().collect();
        #[cfg(not(test))]
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

    /// Re-check USB presence; the engine's proof that a paired key is plugged in right now.
    fn verified_key(&mut self) -> Option<Auth> {
        self.recompute_presence();
        self.present_key_id
            .clone()
            .filter(|_| self.key_present)
            .map(|key_id| Auth::KeyVerified { key_id })
    }

    /// Push the engine's effective policy into the enforcers and announce what changed. The
    /// enforcers only ever see one flat policy plus an on/off switch.
    fn apply_effective(&mut self, tick: &Tick) {
        let policy = talysman_engine::effective::flatten_network(&tick.effective.layers);
        let active = tick.effective.active();
        let source = if !active {
            self.focus_source
        } else if self
            .engine
            .snapshot(&self.ctx())
            .profiles
            .iter()
            .any(|p| p.activation.active && p.activation.latched)
        {
            FocusSource::User
        } else {
            FocusSource::Schedule
        };
        let policy_changed = policy != self.network_policy;
        if policy_changed {
            self.pending_judges.clear();
            self.shared.set_policy(policy.clone());
            self.network_policy = policy.clone();
            self.emit("policyChanged", json!({ "policy": policy }));
        }
        self.shared
            .set_handshake_enabled(self.state.settings.browser_handshake_enabled || !policy.sites.is_empty());
        if active != self.active {
            self.pending_judges.clear();
            self.active = active;
            self.focus_source = source;
            self.shared.set_active(active);
            enforce::apply_network(active);
            self.record_transition(if active { TransitionKind::FocusOn } else { TransitionKind::FocusOff }, source);
            self.emit("focusChanged", json!({ "active": active, "source": source }));
            tracing::info!("enforcement {} ({:?})", if active { "on" } else { "off" }, source);
        }
    }

    fn handle_tick(&mut self, tick: &Tick) -> bool {
        use talysman_engine::engine::EngineEvent;
        self.apply_effective(tick);
        let mut changed = false;
        for event in &tick.events {
            changed = true;
            if let EngineEvent::ScheduleFired { profile_id, action } = event {
                self.record_transition(TransitionKind::ScheduleFired, FocusSource::Schedule);
                self.emit("scheduleFired", json!({ "profileId": profile_id, "action": action }));
            }
        }
        changed
    }

    /// Advance the engine clock (schedule edges, pool/override expiry) and return how long to
    /// sleep before the next time-driven change.
    pub fn tick(&mut self) -> Duration {
        let ctx = self.ctx();
        let tick = self.engine.tick(&ctx);
        if self.handle_tick(&tick) {
            self.persist_state();
        }
        let wait = tick.next_wake_ms.saturating_sub(ctx.now.epoch_ms).max(0) as u64;
        // Wake a beat after the edge so the next tick lands on the far side of it.
        Duration::from_millis(wait + 50).min(MAX_TICK_DELAY)
    }

    /// Run one engine command, verifying the USB key if (and only if) the engine asks for it.
    fn run_command(&mut self, cmd: Command) -> Result<talysman_engine::Applied, RpcError> {
        let ctx = self.ctx();
        let auth = match self.engine.gate(&cmd, &ctx) {
            Gate::NeedsKey { .. } => match self.verified_key() {
                Some(auth) => auth,
                None => {
                    return Err(RpcError::new(err::KEY_REQUIRED, "Insert your paired key to do this."));
                }
            },
            _ => Auth::None,
        };
        let applied = self.engine.apply(cmd, auth, &ctx)?;
        self.handle_tick(&applied.tick);
        self.persist_state();
        Ok(applied)
    }

    fn default_profile_id(&self) -> Option<String> {
        self.engine
            .state
            .default_profile_id
            .clone()
            .or_else(|| self.engine.state.profiles.first().map(|p| p.id.clone()))
    }

    /// Legacy `enableFocus` (tray, focus CLI): latch the default profile on.
    fn enable_focus(&mut self) -> Result<(), RpcError> {
        if self.active {
            return Ok(());
        }
        if !self.has_paired_keys() {
            return Err(RpcError::new(err::NO_PAIRED_KEY, "Pair a key before turning on focus."));
        }
        let Some(profile_id) = self.default_profile_id() else {
            return Err(RpcError::new(err::BAD_REQUEST, "No profile to turn on."));
        };
        self.run_command(Command::SetLatch { profile_id, on: true })?;
        Ok(())
    }

    /// Legacy `disableFocus`: override (1), everything off until re-enabled (key-gated).
    fn disable_focus(&mut self) -> Result<(), RpcError> {
        if !self.active {
            return Ok(());
        }
        self.run_command(Command::StartOverrideAll)?;
        Ok(())
    }

    /// Toggle the browser handshake dead-man's switch. Enabling is free; **disabling** needs the
    /// key and is refused while a locked window holds an active profile.
    fn set_browser_handshake(&mut self, enabled: bool) -> Result<(), RpcError> {
        if self.state.settings.browser_handshake_enabled == enabled {
            return Ok(());
        }
        if !enabled {
            if self.snapshot().schedule_locked {
                return Err(RpcError::new(err::LOCKED, "A locked schedule window is active."));
            }
            if self.verified_key().is_none() {
                return Err(RpcError::new(err::KEY_REQUIRED, "Insert your paired key to change this setting."));
            }
        }
        self.state.settings.browser_handshake_enabled = enabled;
        self.shared
            .set_handshake_enabled(enabled || !self.network_policy.sites.is_empty());
        self.persist_state();
        self.emit(
            "settingsChanged",
            json!({ "settings": self.state.settings.clone() }),
        );
        tracing::info!("browser handshake set to {enabled}");
        Ok(())
    }

    /// Toggle the tray helper's icon. Purely cosmetic (not a security boundary) — never gated.
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

    /// Answer a judge request immediately without asking the judge.
    fn emit_judge_result(&self, request_id: &str, url: &str, verdict: DefaultAction, reason: &str) {
        self.emit(
            "judgeResult",
            json!({ "requestId": request_id, "url": url, "verdict": verdict_for(verdict), "reason": reason }),
        );
    }

    /// Extension (via natmsg) → service: a policy rule resolved to `judge` for this page. Record
    /// it as pending with the active judge policy attached and broadcast `judgeRequested` for
    /// Electron to pick up; the real answer comes back later as `submitJudgeVerdict` (or the
    /// timeout sweep answers with the judge's fallback). Fire-and-forget from the RPC caller's
    /// perspective; malformed/overloaded requests are refused.
    fn judge_request(&mut self, params: &Value) -> Result<(), RpcError> {
        let text = |name: &str| params.get(name).and_then(Value::as_str).unwrap_or("").to_string();
        let request_id = text("requestId");
        let url = text("url");
        let title = text("title");
        let content = text("content");
        // Limits count characters: the extension caps page text by characters, and non-ASCII
        // pages are several bytes per character.
        let too_long = |value: &str, max: usize| value.chars().count() > max;
        if request_id.is_empty()
            || too_long(&request_id, JUDGE_MAX_REQUEST_ID)
            || too_long(&url, JUDGE_MAX_URL)
            || too_long(&title, JUDGE_MAX_TITLE)
            || too_long(&content, JUDGE_MAX_CONTENT)
        {
            return Err(RpcError::new(err::BAD_REQUEST, "Invalid judge request size."));
        }
        if self.pending_judges.contains_key(&request_id) {
            return Err(RpcError::new(err::BAD_REQUEST, "Duplicate judge request id."));
        }
        if self.pending_judges.len() >= 128 {
            return Err(RpcError::new(err::BAD_REQUEST, "Too many pending judge requests."));
        }
        let context = params
            .get("context")
            .filter(|context| context.get("site").and_then(Value::as_str).is_some())
            .map(|context| json!({ "site": context["site"], "feature": context.get("feature").cloned().unwrap_or(Value::Null) }));
        let policy = self.network_policy.clone();
        tracing::info!(
            request_id = %request_id,
            url = %url,
            content_len = content.len(),
            smart_filtering_enabled = self.state.settings.smart_filtering_enabled,
            focus_active = self.focus_active(),
            judge_active = policy.judge.is_some(),
            "judge request received"
        );
        if !self.focus_active() {
            self.emit_judge_result(&request_id, &url, DefaultAction::Allow, "Focus is off");
            return Ok(());
        }
        // A stale extension request after the profile or settings changed must not wake Electron
        // or sit pending. Answer immediately with what the policy falls back to.
        let Some(judge) = policy.judge.clone().filter(|judge| !judge.tasks.is_empty()) else {
            self.emit_judge_result(&request_id, &url, DefaultAction::Allow, "AI filtering is not configured");
            return Ok(());
        };
        if !self.state.settings.smart_filtering_enabled {
            self.emit_judge_result(&request_id, &url, judge.fallback, "AI filtering is unavailable");
            return Ok(());
        }
        self.pending_judges.insert(
            request_id.clone(),
            PendingJudge { requested_at: Instant::now(), url: url.clone(), judge: judge.clone() },
        );
        let mut payload = json!({
            "requestId": request_id,
            "url": url,
            "title": title,
            "content": content,
            "judge": judge,
        });
        if let Some(context) = context {
            payload["context"] = context;
        }
        self.emit("judgeRequested", payload);
        tracing::info!(request_id = %request_id, "judgeRequested emitted");
        Ok(())
    }

    /// Electron main → service: the verdict for a pending `judgeRequested`. Unknown/already-
    /// resolved `requestId`s are ignored — either the timeout sweep already answered with the
    /// fallback, or this is a stale/duplicate report — so the extension is never answered twice.
    fn submit_judge_verdict(&mut self, request_id: &str, verdict: DefaultAction, reason: String) {
        let Some(pending) = self.pending_judges.remove(request_id) else {
            tracing::warn!(request_id, "judge verdict ignored: request is no longer pending");
            return;
        };
        // Discard a paid verdict if the judge policy changed while it was in flight. The extension
        // also invalidates its request on every state generation, so emitting here would be stale.
        if !self.focus_active() || self.network_policy.judge.as_ref() != Some(&pending.judge) {
            tracing::warn!(request_id, "judge verdict ignored: focus or judge policy changed");
            return;
        }
        tracing::info!(request_id, verdict = verdict_for(verdict), reason = %reason, "judge verdict accepted");
        self.emit_judge_result(request_id, &pending.url, verdict, &reason);
    }

    /// Answer every `judgeRequest` that has been pending longer than `JUDGE_TIMEOUT` with the
    /// requesting profile's judge fallback, so a judge that never reports back (Electron not
    /// running, no auth session, the web call failing) never leaves the extension hanging. Called
    /// on a timer from `service.rs`, independent of focus/monitoring state, so it always runs.
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
            tracing::warn!("judge request {request_id} timed out; answering with the judge fallback");
            self.emit_judge_result(&request_id, &pending.url, pending.judge.fallback, "AI judge unavailable");
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
        // While anything is enforced, pairing a new key needs an already-paired key present:
        // otherwise any spare USB stick could be paired and immediately used to switch off.
        let ctx = self.ctx();
        let auth = match self.engine.gate(&Command::PairKey, &ctx) {
            Gate::NeedsKey { .. } => self.verified_key().ok_or_else(|| {
                RpcError::new(err::KEY_REQUIRED, "Insert a key you already paired to pair another while blocking is on.")
            })?,
            _ => Auth::None,
        };

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
        let ctx = self.ctx();
        let _ = self.engine.apply(Command::PairKey, auth, &ctx);
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
        let Some(auth) = self.verified_key() else {
            return Err(RpcError::new(
                err::KEY_REQUIRED,
                "Insert a paired key to remove a key.",
            ));
        };
        let ctx = self.ctx();
        self.engine.apply(Command::UnpairKey, auth, &ctx)?;
        self.state.paired_keys.retain(|k| k.id != key_id);
        self.store.remove_key(key_id);
        self.persist_all();
        self.recompute_presence();
        Ok(())
    }

    /// Re-arm enforcement at boot for whatever the engine says is active now (replaying schedule
    /// events missed while the service was down).
    pub fn rearm_on_boot(&mut self) {
        if !self.has_paired_keys() {
            let mut cleared = false;
            for profile in &mut self.engine.state.profiles {
                if profile.latch.is_on() {
                    profile.latch = talysman_engine::model::Latch::Off;
                    cleared = true;
                }
            }
            if cleared {
                tracing::warn!("clearing persisted profile latches because no key is paired");
            }
        }
        let ctx = self.ctx();
        let tick = self.engine.tick(&ctx);
        self.handle_tick(&tick);
        // Enforcement starts from a clean slate on boot; make sure it holds the engine's view.
        self.shared.set_policy(self.network_policy.clone());
        if self.active {
            self.shared.set_active(true);
            enforce::apply_network(true);
            tracing::info!("re-armed enforcement on boot");
        }
        self.save();
        self.recompute_presence();
    }

    /// A process-killer just closed a blocked app: tell Electron so it can show the unlock popup.
    pub fn app_blocked(&mut self, app: crate::model::AppRef) {
        let ctx = self.ctx();
        let popup = self.engine.popup_info(&PopupTarget::App { app: app.clone() }, &ctx);
        self.emit("appBlocked", json!({ "app": app, "popupInfo": popup }));
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
            // v5 shorthands kept for the tray and focus CLIs.
            "enableFocus" => {
                self.enable_focus()?;
                Ok(ok())
            }
            "disableFocus" => {
                self.disable_focus()?;
                Ok(ok())
            }
            "toggleFocus" => {
                if self.active {
                    self.disable_focus()?;
                } else {
                    self.enable_focus()?;
                }
                Ok(json!({ "ok": true, "active": self.active }))
            }
            "applyCommand" => {
                let command: Command = parse_field(params, "command")?;
                if params.get("dryRun").and_then(Value::as_bool) == Some(true) {
                    let gate = self.engine.gate(&command, &self.ctx());
                    return Ok(json!({ "gate": gate }));
                }
                let applied = self.run_command(command)?;
                Ok(json!({ "ok": true, "journal": applied.journal }))
            }
            "getPopupInfo" => {
                let target: PopupTarget = parse_field(params, "target")?;
                let info = self.engine.popup_info(&target, &self.ctx());
                Ok(serde_json::to_value(info).unwrap())
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
                // Site capability isn't required: natmsg hard-blocks whatever the extension can't
                // enforce, so any extension that can block is enforcing the policy.
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
                self.judge_request(params)?;
                Ok(ok())
            }
            "submitJudgeVerdict" => {
                let request_id = str_field(params, "requestId")?;
                let verdict: DefaultAction = parse_field(params, "verdict")?;
                let reason = str_field(params, "reason")?;
                self.submit_judge_verdict(&request_id, verdict, reason);
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

#[cfg(test)]
mod test_support {
    use super::*;
    use talysman_engine::engine::ProfileInput;
    use talysman_engine::model::{EngineState, Latch, LatchSource, Profile as EngineProfile, ProfileConfig};

    /// A core with one profile holding `policy`, latched on when `active`, and a paired key.
    pub fn core_with(policy: Policy, active: bool) -> (Core, broadcast::Receiver<Value>) {
        let mut engine = EngineState::new("test");
        engine.profiles.push(EngineProfile {
            id: "p".into(),
            name: "P".into(),
            color: "#000".into(),
            created_at_ms: 0,
            config: ProfileConfig { policy, ..Default::default() },
            latch: if active { Latch::On { since_ms: 0, source: LatchSource::User } } else { Latch::Off },
        });
        let mut state = PersistentState::default();
        state.engine = Some(engine);
        state.paired_keys.push(PairedKey { id: "k".into(), label: "K".into(), serial_ambiguous: false, paired_at: 0 });
        let mut core = Core::new(state, SecureStore::default(), Arc::new(EnforceShared::new(Policy::default(), false)));
        let rx = core.subscribe();
        let ctx = core.ctx();
        let tick = core.engine.tick(&ctx);
        core.apply_effective(&tick);
        (core, rx)
    }

    pub fn input(id: &str, policy: Policy) -> ProfileInput {
        ProfileInput { id: id.into(), name: id.into(), color: "#000".into(), config: ProfileConfig { policy, ..Default::default() } }
    }
}

#[cfg(test)]
mod dispatch_tests {
    use super::test_support::*;
    use super::*;

    fn blocks(domains: &[&str]) -> Policy {
        Policy { blocked_domains: domains.iter().map(|d| d.to_string()).collect(), ..Default::default() }
    }

    fn apply(core: &mut Core, command: Value) -> Result<Value, RpcError> {
        core.dispatch("applyCommand", &json!({ "command": command }))
    }

    #[test]
    fn get_state_reports_the_flat_policy_and_the_engine_snapshot() {
        let (mut core, _rx) = core_with(blocks(&["reddit.com"]), true);
        let state = core.dispatch("getState", &Value::Null).unwrap_or_else(|_| panic!());
        assert_eq!(state["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(state["focusActive"], true);
        assert_eq!(state["policy"]["blockedDomains"][0], "reddit.com");
        assert_eq!(state["engine"]["profiles"][0]["activation"]["active"], true);
        assert_eq!(state["engine"]["emergencyLeft"], 5);
        assert!(core.shared.is_active());
    }

    #[test]
    fn relaxing_needs_the_usb_key_and_dry_run_reports_it() {
        let (mut core, _rx) = core_with(blocks(&["reddit.com"]), true);
        let upsert = json!({ "type": "upsertProfile", "profile": input("p", blocks(&[])) });
        let dry = core.dispatch("applyCommand", &json!({ "command": upsert, "dryRun": true })).unwrap_or_else(|_| panic!());
        assert_eq!(dry["gate"]["kind"], "needsKey");
        let refused = apply(&mut core, upsert.clone()).err().unwrap();
        assert_eq!(refused.code, err::KEY_REQUIRED);
        core.test_present_key = Some("k".into());
        apply(&mut core, upsert).unwrap_or_else(|e| panic!("{}", e.message));
        assert!(core.network_policy.blocked_domains.is_empty());
    }

    #[test]
    fn disable_and_enable_focus_map_to_override_and_latch() {
        let (mut core, mut rx) = core_with(blocks(&["reddit.com"]), true);
        assert_eq!(core.dispatch("disableFocus", &json!({})).err().unwrap().code, err::KEY_REQUIRED);
        core.test_present_key = Some("k".into());
        core.dispatch("disableFocus", &json!({})).unwrap_or_else(|_| panic!());
        assert!(!core.focus_active());
        assert!(!core.shared.is_active());
        let mut saw_focus_changed = false;
        while let Ok(event) = rx.try_recv() {
            saw_focus_changed |= event["event"] == "focusChanged" && event["payload"]["active"] == false;
        }
        assert!(saw_focus_changed);
        core.dispatch("enableFocus", &json!({})).unwrap_or_else(|_| panic!());
        assert!(core.focus_active());
    }

    #[test]
    fn emergency_unlock_needs_no_key() {
        let (mut core, _rx) = core_with(blocks(&["reddit.com"]), true);
        apply(&mut core, json!({ "type": "emergencyUnlock" })).unwrap_or_else(|e| panic!("{}", e.message));
        assert!(!core.focus_active());
        assert_eq!(core.snapshot().engine.emergency_left, 4);
    }

    #[test]
    fn pairing_while_active_needs_an_existing_key() {
        let (mut core, _rx) = core_with(blocks(&["reddit.com"]), true);
        let refused = core.dispatch("pairKey", &json!({ "driveId": "nope", "label": "" })).err().unwrap();
        assert_eq!(refused.code, err::KEY_REQUIRED);
        core.test_present_key = Some("k".into());
        // Past the key gate, the (nonexistent) drive is what fails.
        let refused = core.dispatch("pairKey", &json!({ "driveId": "nope", "label": "" })).err().unwrap();
        assert_eq!(refused.code, err::BAD_REQUEST);
    }

    #[test]
    fn popup_info_for_a_blocked_url() {
        let (mut core, _rx) = core_with(blocks(&["reddit.com"]), true);
        let info = core
            .dispatch("getPopupInfo", &json!({ "target": { "kind": "url", "url": "https://www.reddit.com/" } }))
            .unwrap_or_else(|_| panic!());
        assert_eq!(info["verdict"]["kind"], "hard");
        assert_eq!(info["blockingProfiles"][0]["id"], "p");
        assert_eq!(info["unlockAvailable"], false);
    }
}

#[cfg(test)]
mod judge_tests {
    use super::*;
    use crate::model::{JudgePolicy, RuleAction};
    use talysman_common::policy::JudgeTask;

    fn judge(title: &str, fallback: DefaultAction) -> JudgePolicy {
        JudgePolicy {
            tasks: vec![JudgeTask { id: "t".into(), title: title.into(), notes: None }],
            avoid: vec!["sports".into()],
            fallback,
        }
    }

    fn core(judge: Option<JudgePolicy>, focus: bool, smart: bool) -> (Core, broadcast::Receiver<Value>) {
        let policy = Policy { default_action: RuleAction::Judge, judge, ..Default::default() };
        let (mut core, rx) = super::test_support::core_with(policy, focus);
        core.state.settings.smart_filtering_enabled = smart;
        (core, rx)
    }

    fn next_event(rx: &mut broadcast::Receiver<Value>, name: &str) -> Value {
        while let Ok(event) = rx.try_recv() {
            if event["event"] == name {
                return event["payload"].clone();
            }
        }
        panic!("no {name} event");
    }

    fn request(id: &str) -> Value {
        json!({
            "requestId": id, "url": "https://www.reddit.com/r/a/comments/x/", "title": "A post",
            "content": "text", "context": { "site": "reddit", "feature": "content" },
        })
    }

    #[test]
    fn a_judged_page_is_brokered_to_electron_and_the_verdict_relayed() {
        let (mut core, mut rx) = core(Some(judge("thesis", DefaultAction::Allow)), true, true);
        core.judge_request(&request("r1")).unwrap_or_else(|_| panic!());
        let requested = next_event(&mut rx, "judgeRequested");
        assert_eq!(requested["judge"]["tasks"][0]["title"], "thesis");
        assert_eq!(requested["context"], json!({ "site": "reddit", "feature": "content" }));
        assert_eq!(requested["content"], "text");

        core.submit_judge_verdict("r1", DefaultAction::Block, "Off-task".into());
        let result = next_event(&mut rx, "judgeResult");
        assert_eq!(result["verdict"], "block");
        assert_eq!(result["reason"], "Off-task");
        // Answered once only.
        core.submit_judge_verdict("r1", DefaultAction::Allow, String::new());
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn unavailable_ai_filtering_answers_with_the_judge_fallback() {
        let (mut core, mut rx) = core(Some(judge("thesis", DefaultAction::Block)), true, false);
        assert!(core.judge_request(&request("r1")).is_ok());
        assert_eq!(next_event(&mut rx, "judgeResult")["verdict"], "block");
        assert!(core.pending_judges.is_empty());
    }

    #[test]
    fn the_timeout_sweep_answers_with_the_fallback() {
        let (mut core, mut rx) = core(Some(judge("thesis", DefaultAction::Block)), true, true);
        assert!(core.judge_request(&request("r1")).is_ok());
        core.pending_judges.get_mut("r1").unwrap().requested_at = Instant::now() - JUDGE_TIMEOUT;
        core.sweep_expired_judges();
        let result = next_event(&mut rx, "judgeResult");
        assert_eq!(result["verdict"], "block");
        assert_eq!(result["reason"], "AI judge unavailable");
    }

    #[test]
    fn a_verdict_for_since_edited_tasks_is_discarded() {
        let (mut core, mut rx) = core(Some(judge("thesis", DefaultAction::Allow)), true, true);
        assert!(core.judge_request(&request("r1")).is_ok());
        core.network_policy.judge = Some(judge("taxes", DefaultAction::Allow));
        core.submit_judge_verdict("r1", DefaultAction::Block, "Off-task".into());
        while let Ok(event) = rx.try_recv() {
            assert_ne!(event["event"], "judgeResult");
        }
    }

    #[test]
    fn oversized_or_duplicate_requests_are_refused() {
        let (mut core, _rx) = core(Some(judge("thesis", DefaultAction::Allow)), true, true);
        let mut big = request("r1");
        big["content"] = json!("x".repeat(JUDGE_MAX_CONTENT + 1));
        assert!(core.judge_request(&big).is_err());
        let mut wide = request("r3");
        wide["content"] = json!("é".repeat(JUDGE_MAX_CONTENT));
        assert!(core.judge_request(&wide).is_ok());
        assert!(core.judge_request(&request("r2")).is_ok());
        assert!(core.judge_request(&request("r2")).is_err());
    }
}
