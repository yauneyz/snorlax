//! The engine's public API: commands, gating, time advancement, and the views UIs render.
//!
//! Platform contract: call [`Engine::gate`] (or just [`Engine::apply`]) — on `NeedsKey`, verify a
//! paired key yourself (desktop: fresh USB enumeration; Android: NFC/QR scan) and retry with
//! [`Auth::KeyVerified`]. Never construct `KeyVerified` from anything a UI claims. The engine has
//! no clock: pass [`Ctx::now`] on every call and call [`Engine::tick`] by `next_wake_ms`.

use serde::{Deserialize, Serialize};

use crate::activation::{self, Activation};
use crate::effective::{self, Decision, EffectivePolicy, Layer, Target, Verdict};
use crate::model::*;
use crate::policy::AppRef;
use crate::restrictive;
use crate::schedule;
use crate::streak::{self, Streak};
use crate::time::{LocalNow, HOUR_MS};

/// Error codes, mirrored in packages/shared/src/constants.ts.
pub mod codes {
    pub const KEY_REQUIRED: &str = "KEY_REQUIRED";
    pub const LOCKED: &str = "LOCKED";
    pub const NO_PAIRED_KEY: &str = "NO_PAIRED_KEY";
    pub const LAST_PROFILE: &str = "LAST_PROFILE";
    pub const BAD_REQUEST: &str = "BAD_REQUEST";
    pub const NO_EMERGENCY_LEFT: &str = "NO_EMERGENCY_LEFT";
    pub const POOL_EXHAUSTED: &str = "POOL_EXHAUSTED";
    pub const FRICTION_PENDING: &str = "FRICTION_PENDING";
    pub const POOL_ITEM_CONFLICT: &str = "POOL_ITEM_CONFLICT";
    pub const LIMIT_EXCEEDED: &str = "LIMIT_EXCEEDED";
    pub const NOT_BLOCKED: &str = "NOT_BLOCKED";
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct EngineError {
    pub code: String,
    pub message: String,
}

impl EngineError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        EngineError { code: code.to_string(), message: message.into() }
    }
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for EngineError {}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    /// Plan limit on how many profiles may exist (`None` = unlimited).
    #[serde(default)]
    pub max_profiles: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Ctx {
    pub now: LocalNow,
    pub has_paired_keys: bool,
    #[serde(default)]
    pub limits: Limits,
}

impl Ctx {
    pub fn new(epoch_ms: i64, utc_offset_s: i32, has_paired_keys: bool) -> Self {
        Ctx { now: LocalNow::new(epoch_ms, utc_offset_s), has_paired_keys, limits: Limits::default() }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Auth {
    None,
    #[serde(rename_all = "camelCase")]
    KeyVerified { key_id: String },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct LockedProfile {
    pub profile_id: String,
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub until_ms: i64,
}

/// What a command needs before it may run.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Gate {
    Free,
    /// Verify a key. `relaxations` itemizes a config loosening; `lockedProfiles` are profiles the
    /// command will leave alone because a locked window holds them.
    #[serde(rename_all = "camelCase")]
    NeedsKey { relaxations: Vec<String>, locked_profiles: Vec<LockedProfile> },
    /// Nothing the key can do: a locked window holds every affected profile. Only an emergency
    /// unlock (everything off) gets past it.
    #[serde(rename_all = "camelCase")]
    Locked {
        #[cfg_attr(feature = "ts", ts(type = "number"))]
        until_ms: i64,
        profiles: Vec<String>,
    },
    Denied { code: String, message: String },
}

/// A profile as the UI edits it (latch and history are engine-owned).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ProfileInput {
    pub id: String,
    pub name: String,
    pub color: String,
    pub config: ProfileConfig,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Command {
    UpsertProfile { profile: ProfileInput },
    #[serde(rename_all = "camelCase")]
    DuplicateProfile {
        profile_id: String,
        new_id: String,
        #[serde(default)]
        #[cfg_attr(feature = "ts", ts(optional))]
        color: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    DeleteProfile { profile_id: String },
    #[serde(rename_all = "camelCase")]
    SetLatch { profile_id: String, on: bool },
    #[serde(rename_all = "camelCase")]
    SetDefaultProfile { profile_id: String },
    /// Start a pool unlock; with no friction it unlocks immediately.
    RequestPoolUnlock { pools: Vec<PoolRef> },
    /// Finish a pool unlock once its friction has elapsed.
    ConfirmPoolUnlock { pools: Vec<PoolRef> },
    CancelPoolUnlock { pools: Vec<PoolRef> },
    StartOverrideAll,
    StartOverrideExempt { items: Vec<ItemRef>, profiles: Vec<String> },
    StartOverrideTimed { minutes: u16 },
    ReenableAll,
    /// Keyless, 5 per device lifetime: everything off, including locked windows.
    EmergencyUnlock,
    /// Record a key pairing (the platform stores the key). Key-gated while a profile is active.
    PairKey,
    UnpairKey,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum EngineEvent {
    #[serde(rename_all = "camelCase")]
    ProfileActivated { profile_id: String },
    #[serde(rename_all = "camelCase")]
    ProfileDeactivated { profile_id: String },
    EffectiveChanged,
    #[serde(rename_all = "camelCase")]
    OverrideEnded { r#override: OverrideKind },
    #[serde(rename_all = "camelCase")]
    PoolUnlockExpired { pool: PoolRef },
    #[serde(rename_all = "camelCase")]
    ScheduleFired { profile_id: String, action: OnOff },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Tick {
    pub effective: EffectivePolicy,
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub next_wake_ms: i64,
    pub events: Vec<EngineEvent>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    pub journal: Vec<JournalEntry>,
    pub tick: Tick,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct PoolStatus {
    pub profile_id: String,
    pub pool_id: String,
    pub name: String,
    pub unlocks_per_day: u8,
    pub used_today: u8,
    pub left_today: u8,
    pub unlock_minutes: u16,
    pub friction: Friction,
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub active_until_ms: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub enum UpcomingKind {
    WindowStart,
    WindowEnd,
    On,
    Off,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct UpcomingEvent {
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub at_ms: i64,
    pub profile_id: String,
    pub kind: UpcomingKind,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ProfileStatus {
    pub profile: Profile,
    pub activation: Activation,
    /// Could become active without further user action (relaxing it needs the key).
    pub committed: bool,
}

/// Everything a UI renders.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct EngineSnapshot {
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub now_ms: i64,
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub generation: u64,
    pub profiles: Vec<ProfileStatus>,
    pub default_profile_id: Option<String>,
    pub any_active: bool,
    pub overrides: Overrides,
    /// "Re-enable all" should be offered.
    pub overridden: bool,
    pub pools: Vec<PoolStatus>,
    pub pending_unlocks: Vec<PendingPoolUnlock>,
    pub streak: Streak,
    pub emergency_left: u8,
    pub next_events: Vec<UpcomingEvent>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    pub id: String,
    pub name: String,
    pub color: String,
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub locked_until_ms: Option<i64>,
}

/// What the block/unlock popup shows (§3.10 of the spec).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct PopupInfo {
    pub item: Option<ItemRef>,
    /// Human name of the item ("Instagram", "reddit.com").
    pub label: String,
    pub verdict: Verdict,
    pub blocking_profiles: Vec<ProfileSummary>,
    /// One pool per blocking profile that pools this item; an unlock spends one from each.
    pub pools: Vec<PoolStatus>,
    /// Blocking profiles with no pool for this item (no keyless unlock possible).
    pub unpooled_profiles: Vec<String>,
    pub unlock_available: bool,
    pub friction: Friction,
    pub pending: Option<PendingPoolUnlock>,
    pub streak: Streak,
    pub emergency_left: u8,
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub locked_until_ms: Option<i64>,
}

/// What the popup is about.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PopupTarget {
    Url { url: String },
    App { app: AppRef },
}

pub struct Engine {
    pub state: EngineState,
    last_layers: Option<Vec<Layer>>,
    last_active: Vec<String>,
}

fn locked_profiles(acts: &[Activation]) -> Vec<LockedProfile> {
    acts.iter()
        .filter_map(|a| a.locked_until_ms.map(|until_ms| LockedProfile { profile_id: a.profile_id.clone(), until_ms }))
        .collect()
}

fn denied(code: &str, message: impl Into<String>) -> Gate {
    Gate::Denied { code: code.to_string(), message: message.into() }
}

impl Engine {
    pub fn new(state: EngineState) -> Self {
        Engine { state, last_layers: None, last_active: Vec::new() }
    }

    /// Parse persisted state (schema 6).
    pub fn load(json: &str) -> Result<Engine, EngineError> {
        let state: EngineState = serde_json::from_str(json).map_err(|e| EngineError::new(codes::BAD_REQUEST, format!("Bad engine state: {e}")))?;
        Ok(Engine::new(state))
    }

    pub fn export(&self) -> String {
        serde_json::to_string_pretty(&self.state).expect("engine state serializes")
    }

    fn activations(&self, now: &LocalNow) -> Vec<Activation> {
        activation::activations(&self.state, now)
    }

    fn activation_of(&self, id: &str, now: &LocalNow) -> Option<Activation> {
        self.state.profile(id).map(|p| activation::activation(&self.state, p, now))
    }

    fn today(&self, now: &LocalNow) -> String {
        now.date_string()
    }

    fn usage(&self, r: &PoolRef, now: &LocalNow) -> Option<&PoolUsage> {
        let today = self.today(now);
        self.state.pool_usage.iter().find(|u| u.profile_id == r.profile_id && u.pool_id == r.pool_id && u.local_date == today)
    }

    pub fn pool_status(&self, r: &PoolRef, now: &LocalNow) -> Option<PoolStatus> {
        let pool = self.state.pool(r)?;
        let used = self.usage(r, now).map(|u| u.used).unwrap_or(0);
        let active_until_ms = self
            .state
            .pool_usage
            .iter()
            .filter(|u| u.profile_id == r.profile_id && u.pool_id == r.pool_id)
            .filter_map(|u| u.active_until_ms)
            .filter(|until| *until > now.epoch_ms)
            .max();
        Some(PoolStatus {
            profile_id: r.profile_id.clone(),
            pool_id: r.pool_id.clone(),
            name: pool.name.clone(),
            unlocks_per_day: pool.unlocks_per_day,
            used_today: used,
            left_today: pool.unlocks_per_day.saturating_sub(used),
            unlock_minutes: pool.unlock_minutes,
            friction: pool.friction.clone(),
            active_until_ms,
        })
    }

    fn push_journal(&mut self, now: &LocalNow, breaks_streak: bool, kind: JournalKind) -> JournalEntry {
        self.state.journal_seq += 1;
        let entry = JournalEntry {
            id: format!("{}:{}", self.state.device_id, self.state.journal_seq),
            device_id: self.state.device_id.clone(),
            seq: self.state.journal_seq,
            at_ms: now.epoch_ms,
            local_date: now.date_string(),
            breaks_streak,
            kind,
        };
        self.state.journal.push(entry.clone());
        entry
    }

    // -----------------------------------------------------------------------------------------
    // Gating
    // -----------------------------------------------------------------------------------------

    /// What `cmd` needs right now. Pure: UIs call it (a dry run) to show the key prompt up front.
    pub fn gate(&self, cmd: &Command, ctx: &Ctx) -> Gate {
        let now = &ctx.now;
        match cmd {
            Command::UpsertProfile { profile } => {
                let name = profile.name.trim();
                if profile.id.trim().is_empty() || name.is_empty() {
                    return denied(codes::BAD_REQUEST, "Profiles need an id and a name.");
                }
                if name.chars().count() > MAX_PROFILE_NAME_LENGTH {
                    return denied(codes::BAD_REQUEST, format!("Profile names are limited to {MAX_PROFILE_NAME_LENGTH} characters."));
                }
                if let Err(message) = restrictive::validate(&profile.config) {
                    return match message.strip_prefix("POOL_ITEM_CONFLICT: ") {
                        Some(rest) => denied(codes::POOL_ITEM_CONFLICT, rest),
                        None => denied(codes::BAD_REQUEST, message),
                    };
                }
                match self.state.profile(&profile.id) {
                    None => self.gate_new_profile(ctx),
                    Some(prev) => {
                        let relaxations = restrictive::relaxations(&prev.config, &profile.config, now.epoch_ms);
                        if relaxations.is_empty() || !activation::is_committed(&self.state, prev, now) {
                            return Gate::Free;
                        }
                        let a = activation::activation(&self.state, prev, now);
                        match a.locked_until_ms {
                            Some(until_ms) => Gate::Locked { until_ms, profiles: vec![prev.id.clone()] },
                            None => Gate::NeedsKey { relaxations, locked_profiles: Vec::new() },
                        }
                    }
                }
            }
            Command::DuplicateProfile { profile_id, new_id, .. } => {
                if self.state.profile(profile_id).is_none() || new_id.trim().is_empty() || self.state.profile(new_id).is_some() {
                    return denied(codes::BAD_REQUEST, "Can't duplicate that profile.");
                }
                self.gate_new_profile(ctx)
            }
            Command::DeleteProfile { profile_id } => {
                let Some(profile) = self.state.profile(profile_id) else {
                    return denied(codes::BAD_REQUEST, "Profile not found.");
                };
                if self.state.profiles.len() == 1 {
                    return denied(codes::LAST_PROFILE, "Keep at least one blocking profile.");
                }
                if !activation::is_committed(&self.state, profile, now) {
                    return Gate::Free;
                }
                let a = activation::activation(&self.state, profile, now);
                match a.locked_until_ms {
                    Some(until_ms) => Gate::Locked { until_ms, profiles: vec![profile.id.clone()] },
                    None => Gate::NeedsKey { relaxations: vec![format!("Deletes {}", profile.name)], locked_profiles: Vec::new() },
                }
            }
            Command::SetLatch { profile_id, on } => {
                let Some(a) = self.activation_of(profile_id, now) else {
                    return denied(codes::BAD_REQUEST, "Profile not found.");
                };
                if *on {
                    if !ctx.has_paired_keys {
                        return denied(codes::NO_PAIRED_KEY, "Pair a key before turning on a profile.");
                    }
                    return Gate::Free;
                }
                if !a.latched && a.windows.is_empty() {
                    return Gate::Free;
                }
                match a.locked_until_ms {
                    Some(until_ms) => Gate::Locked { until_ms, profiles: vec![profile_id.clone()] },
                    None => Gate::NeedsKey { relaxations: Vec::new(), locked_profiles: Vec::new() },
                }
            }
            Command::SetDefaultProfile { profile_id } => {
                if self.state.profile(profile_id).is_none() {
                    return denied(codes::BAD_REQUEST, "Profile not found.");
                }
                Gate::Free
            }
            Command::RequestPoolUnlock { pools } => self.gate_pools(pools, now),
            Command::ConfirmPoolUnlock { pools } => {
                let gate = self.gate_pools(pools, now);
                if gate != Gate::Free {
                    return gate;
                }
                let friction = self.max_friction_secs(pools);
                match self.pending_for(pools) {
                    Some(p) if p.ready_ms > now.epoch_ms => denied(codes::FRICTION_PENDING, "Take a breath first."),
                    None if friction > 0 => denied(codes::FRICTION_PENDING, "Start the unlock first."),
                    _ => Gate::Free,
                }
            }
            Command::CancelPoolUnlock { .. } | Command::ReenableAll => Gate::Free,
            Command::StartOverrideAll => {
                let acts = self.activations(now);
                let active: Vec<&Activation> = acts.iter().filter(|a| a.active).collect();
                if active.is_empty() {
                    return Gate::Free;
                }
                let locked = locked_profiles(&acts);
                if active.iter().all(|a| a.locked()) {
                    return Gate::Locked { until_ms: locked.iter().map(|l| l.until_ms).max().unwrap_or(now.epoch_ms), profiles: locked.into_iter().map(|l| l.profile_id).collect() };
                }
                Gate::NeedsKey { relaxations: Vec::new(), locked_profiles: locked }
            }
            Command::StartOverrideExempt { items, profiles } => {
                if items.is_empty() && profiles.is_empty() {
                    return denied(codes::BAD_REQUEST, "Choose what to turn off.");
                }
                if profiles.iter().any(|id| self.state.profile(id).is_none()) {
                    return denied(codes::BAD_REQUEST, "Profile not found.");
                }
                let acts = self.activations(now);
                let locked: Vec<LockedProfile> = locked_profiles(&acts)
                    .into_iter()
                    .filter(|l| !items.is_empty() || profiles.contains(&l.profile_id))
                    .collect();
                let all_chosen_locked = items.is_empty() && profiles.iter().all(|id| locked.iter().any(|l| &l.profile_id == id));
                if all_chosen_locked {
                    return Gate::Locked { until_ms: locked.iter().map(|l| l.until_ms).max().unwrap_or(now.epoch_ms), profiles: profiles.clone() };
                }
                Gate::NeedsKey { relaxations: Vec::new(), locked_profiles: locked }
            }
            Command::StartOverrideTimed { minutes } => {
                if *minutes == 0 || *minutes > MAX_TIMED_OVERRIDE_MINUTES {
                    return denied(codes::BAD_REQUEST, format!("Pause for 1–{MAX_TIMED_OVERRIDE_MINUTES} minutes."));
                }
                let acts = self.activations(now);
                let locked = locked_profiles(&acts);
                let active: Vec<&Activation> = acts.iter().filter(|a| a.active).collect();
                if !active.is_empty() && active.iter().all(|a| a.locked()) {
                    return Gate::Locked { until_ms: locked.iter().map(|l| l.until_ms).max().unwrap_or(now.epoch_ms), profiles: locked.into_iter().map(|l| l.profile_id).collect() };
                }
                Gate::NeedsKey { relaxations: Vec::new(), locked_profiles: locked }
            }
            Command::EmergencyUnlock => {
                if streak::emergency_left(&self.state) == 0 {
                    return denied(codes::NO_EMERGENCY_LEFT, "No emergency unlocks left.");
                }
                Gate::Free
            }
            Command::PairKey => {
                if ctx.has_paired_keys && self.activations(now).iter().any(|a| a.active) {
                    Gate::NeedsKey { relaxations: vec!["Pairs a new key while blocking is on".into()], locked_profiles: Vec::new() }
                } else {
                    Gate::Free
                }
            }
            Command::UnpairKey => Gate::NeedsKey { relaxations: Vec::new(), locked_profiles: Vec::new() },
        }
    }

    fn gate_new_profile(&self, ctx: &Ctx) -> Gate {
        if let Some(max) = ctx.limits.max_profiles {
            if self.state.profiles.len() as u32 >= max {
                return denied(codes::LIMIT_EXCEEDED, "Your plan's profile limit is reached.");
            }
        }
        Gate::Free
    }

    fn gate_pools(&self, pools: &[PoolRef], now: &LocalNow) -> Gate {
        if pools.is_empty() {
            return denied(codes::NOT_BLOCKED, "Nothing to unlock.");
        }
        for r in pools {
            let Some(status) = self.pool_status(r, now) else {
                return denied(codes::BAD_REQUEST, "Pool not found.");
            };
            if status.left_today == 0 {
                return denied(codes::POOL_EXHAUSTED, format!("No {} unlocks left today.", status.name));
            }
        }
        Gate::Free
    }

    fn max_friction_secs(&self, pools: &[PoolRef]) -> u16 {
        pools.iter().filter_map(|r| self.state.pool(r)).map(|p| p.friction.secs()).max().unwrap_or(0)
    }

    fn pending_for(&self, pools: &[PoolRef]) -> Option<&PendingPoolUnlock> {
        let mut wanted = pools.to_vec();
        wanted.sort();
        self.state.pending_unlocks.iter().find(|p| p.pools == wanted)
    }

    // -----------------------------------------------------------------------------------------
    // Applying commands
    // -----------------------------------------------------------------------------------------

    pub fn apply(&mut self, cmd: Command, auth: Auth, ctx: &Ctx) -> Result<Applied, EngineError> {
        let now = ctx.now;
        let mut events = self.advance(&now);
        let gate = self.gate(&cmd, ctx);
        let keyed = match gate {
            Gate::Free => false,
            Gate::NeedsKey { ref relaxations, .. } => {
                if !matches!(auth, Auth::KeyVerified { .. }) {
                    let detail = if relaxations.is_empty() { String::new() } else { format!(" ({})", relaxations.join("; ")) };
                    return Err(EngineError::new(codes::KEY_REQUIRED, format!("Verify your key to do this{detail}.")));
                }
                true
            }
            Gate::Locked { .. } => return Err(EngineError::new(codes::LOCKED, "A locked schedule window is active.")),
            Gate::Denied { code, message } => return Err(EngineError::new(&code, message)),
        };
        let first_journal = self.state.journal.len();
        self.execute(cmd, keyed, &now);
        let journal = self.state.journal[first_journal..].to_vec();
        let mut tick = self.finalize(&now);
        events.append(&mut tick.events);
        tick.events = events;
        Ok(Applied { journal, tick })
    }

    fn suppress_live(&mut self, profile_id: &str, now: &LocalNow, include_locked: bool) {
        let Some(profile) = self.state.profile(profile_id) else { return };
        for occ in activation::raw_occurrences(profile, now) {
            if occ.locked && !include_locked {
                continue;
            }
            let list = if occ.locked { &mut self.state.overrides.locked_bypass } else { &mut self.state.overrides.suppressed };
            if !list.iter().any(|o| o.same(&occ)) {
                list.push(occ);
            }
        }
    }

    /// Latch a profile off, remembering its prior latch for "Re-enable all".
    fn latch_off_remembering(&mut self, profile_id: &str, prior: &mut Vec<PriorLatch>) {
        let Some(profile) = self.state.profile_mut(profile_id) else { return };
        if profile.latch.is_on() {
            if !prior.iter().any(|p| p.profile_id == profile_id) {
                prior.push(PriorLatch { profile_id: profile_id.to_string(), latch: profile.latch.clone() });
            }
            profile.latch = Latch::Off;
        }
    }

    fn all_off(&mut self, now: &LocalNow, emergency: bool) {
        let acts = self.activations(now);
        let mut prior = self.state.overrides.all_off.take().map(|a| a.prior_latches).unwrap_or_default();
        let ids: Vec<String> = self.state.profiles.iter().map(|p| p.id.clone()).collect();
        for id in ids {
            let locked = acts.iter().any(|a| a.profile_id == id && a.locked());
            if locked && !emergency {
                continue;
            }
            self.latch_off_remembering(&id, &mut prior);
            self.suppress_live(&id, now, emergency);
        }
        self.state.overrides.all_off = Some(AllOff { since_ms: now.epoch_ms, emergency, prior_latches: prior });
    }

    fn execute(&mut self, cmd: Command, keyed: bool, now: &LocalNow) {
        match cmd {
            Command::UpsertProfile { profile } => {
                let name = profile.name.trim().to_string();
                match self.state.profiles.iter().position(|p| p.id == profile.id) {
                    Some(idx) => {
                        let relaxed = restrictive::relaxations(&self.state.profiles[idx].config, &profile.config, now.epoch_ms);
                        let p = &mut self.state.profiles[idx];
                        p.name = name;
                        p.color = profile.color;
                        p.config = profile.config;
                        if keyed {
                            self.push_journal(now, true, JournalKind::Relaxed { profile_id: profile.id, summary: relaxed });
                        }
                    }
                    None => self.state.profiles.push(Profile {
                        id: profile.id,
                        name,
                        color: profile.color,
                        created_at_ms: now.epoch_ms,
                        config: profile.config,
                        latch: Latch::Off,
                    }),
                }
            }
            Command::DuplicateProfile { profile_id, new_id, color } => {
                let Some(source) = self.state.profile(&profile_id).cloned() else { return };
                let mut name = format!("{} copy", source.name);
                if name.chars().count() > MAX_PROFILE_NAME_LENGTH {
                    name = name.chars().take(MAX_PROFILE_NAME_LENGTH).collect();
                }
                let mut config = source.config.clone();
                config.one_shots.retain(|e| e.fired_at_ms.is_none());
                self.state.profiles.push(Profile {
                    id: new_id,
                    name,
                    color: color.unwrap_or(source.color),
                    created_at_ms: now.epoch_ms,
                    config,
                    latch: Latch::Off,
                });
            }
            Command::DeleteProfile { profile_id } => {
                self.state.profiles.retain(|p| p.id != profile_id);
                self.state.pool_usage.retain(|u| u.profile_id != profile_id);
                self.state.pending_unlocks.retain(|p| p.pools.iter().all(|r| r.profile_id != profile_id));
                let o = &mut self.state.overrides;
                o.suppressed.retain(|s| s.profile_id != profile_id);
                o.locked_bypass.retain(|s| s.profile_id != profile_id);
                if let Some(a) = &mut o.all_off {
                    a.prior_latches.retain(|p| p.profile_id != profile_id);
                }
                if let Some(e) = &mut o.exempt {
                    e.prior_latches.retain(|p| p.profile_id != profile_id);
                    e.profiles.retain(|p| *p != profile_id);
                }
                if self.state.default_profile_id.as_deref() == Some(&profile_id) {
                    self.state.default_profile_id = None;
                }
                self.push_journal(now, keyed, JournalKind::ProfileDeleted { profile_id });
            }
            Command::SetLatch { profile_id, on } => {
                if on {
                    let Some(p) = self.state.profile_mut(&profile_id) else { return };
                    if p.latch.is_on() {
                        return;
                    }
                    p.latch = Latch::On { since_ms: now.epoch_ms, source: LatchSource::User };
                    self.push_journal(now, false, JournalKind::ProfileOn { profile_id, source: ChangeSource::User });
                } else {
                    if let Some(p) = self.state.profile_mut(&profile_id) {
                        p.latch = Latch::Off;
                    }
                    self.suppress_live(&profile_id, now, false);
                    self.push_journal(now, keyed, JournalKind::ProfileOff { profile_id, source: ChangeSource::User });
                }
            }
            Command::SetDefaultProfile { profile_id } => self.state.default_profile_id = Some(profile_id),
            Command::RequestPoolUnlock { mut pools } => {
                pools.sort();
                pools.dedup();
                let friction = self.max_friction_secs(&pools);
                self.state.pending_unlocks.retain(|p| p.pools != pools);
                if friction == 0 {
                    self.unlock_pools(&pools, now);
                } else {
                    self.state.pending_unlocks.push(PendingPoolUnlock {
                        pools,
                        requested_ms: now.epoch_ms,
                        ready_ms: now.epoch_ms + friction as i64 * 1000,
                    });
                }
            }
            Command::ConfirmPoolUnlock { mut pools } => {
                pools.sort();
                pools.dedup();
                self.state.pending_unlocks.retain(|p| p.pools != pools);
                self.unlock_pools(&pools, now);
            }
            Command::CancelPoolUnlock { mut pools } => {
                pools.sort();
                self.state.pending_unlocks.retain(|p| p.pools != pools);
            }
            Command::StartOverrideAll => {
                if !self.activations(now).iter().any(|a| a.active) {
                    return;
                }
                self.all_off(now, false);
                self.push_journal(now, true, JournalKind::OverrideStarted { r#override: OverrideKind::AllOff });
            }
            Command::StartOverrideExempt { items, profiles } => {
                let acts = self.activations(now);
                let mut exempt = self.state.overrides.exempt.take().unwrap_or(Exempt {
                    since_ms: now.epoch_ms,
                    items: Vec::new(),
                    profiles: Vec::new(),
                    prior_latches: Vec::new(),
                });
                for item in items {
                    if !exempt.items.contains(&item) {
                        exempt.items.push(item);
                    }
                }
                let mut prior = std::mem::take(&mut exempt.prior_latches);
                for id in profiles {
                    if acts.iter().any(|a| a.profile_id == id && a.locked()) {
                        continue;
                    }
                    self.latch_off_remembering(&id, &mut prior);
                    self.suppress_live(&id, now, false);
                    if !exempt.profiles.contains(&id) {
                        exempt.profiles.push(id);
                    }
                }
                exempt.prior_latches = prior;
                self.state.overrides.exempt = Some(exempt);
                self.push_journal(now, true, JournalKind::OverrideStarted { r#override: OverrideKind::Exempt });
            }
            Command::StartOverrideTimed { minutes } => {
                self.state.overrides.timed = Some(TimedOff { since_ms: now.epoch_ms, until_ms: now.epoch_ms + minutes as i64 * 60_000 });
                self.push_journal(now, true, JournalKind::OverrideStarted { r#override: OverrideKind::Timed });
            }
            Command::ReenableAll => {
                let o = std::mem::take(&mut self.state.overrides);
                let had = o.any() || !o.suppressed.is_empty() || !o.locked_bypass.is_empty();
                let priors = o.all_off.into_iter().flat_map(|a| a.prior_latches).chain(o.exempt.into_iter().flat_map(|e| e.prior_latches));
                for prior in priors {
                    if let Some(p) = self.state.profile_mut(&prior.profile_id) {
                        if !p.latch.is_on() {
                            p.latch = prior.latch;
                        }
                    }
                }
                if had {
                    self.push_journal(now, false, JournalKind::ReenabledAll);
                }
            }
            Command::EmergencyUnlock => {
                self.all_off(now, true);
                self.state.overrides.timed = None;
                self.push_journal(now, true, JournalKind::EmergencyUsed);
            }
            Command::PairKey => {
                self.push_journal(now, false, JournalKind::KeyPaired);
            }
            Command::UnpairKey => {
                self.push_journal(now, false, JournalKind::KeyUnpaired);
            }
        }
    }

    fn unlock_pools(&mut self, pools: &[PoolRef], now: &LocalNow) {
        let today = self.today(now);
        let mut minutes = 0;
        for r in pools {
            let Some(pool) = self.state.pool(r).cloned() else { continue };
            minutes = minutes.max(pool.unlock_minutes);
            let until = now.epoch_ms + pool.unlock_minutes as i64 * 60_000;
            match self
                .state
                .pool_usage
                .iter_mut()
                .find(|u| u.profile_id == r.profile_id && u.pool_id == r.pool_id && u.local_date == today)
            {
                Some(u) => {
                    u.used = u.used.saturating_add(1);
                    u.active_until_ms = Some(u.active_until_ms.map_or(until, |prev| prev.max(until)));
                }
                None => self.state.pool_usage.push(PoolUsage {
                    profile_id: r.profile_id.clone(),
                    pool_id: r.pool_id.clone(),
                    local_date: today.clone(),
                    used: 1,
                    active_until_ms: Some(until),
                }),
            }
        }
        self.push_journal(now, false, JournalKind::PoolUnlocked { pools: pools.to_vec(), minutes });
    }

    // -----------------------------------------------------------------------------------------
    // Time
    // -----------------------------------------------------------------------------------------

    /// Fire due schedule events, expire unlocks and overrides, and recompute the effective policy.
    pub fn tick(&mut self, ctx: &Ctx) -> Tick {
        let now = ctx.now;
        let mut events = self.advance(&now);
        let mut tick = self.finalize(&now);
        events.append(&mut tick.events);
        tick.events = events;
        tick
    }

    /// Time-driven state changes since `last_evaluated_ms`.
    fn advance(&mut self, now: &LocalNow) -> Vec<EngineEvent> {
        let mut events = Vec::new();
        let last = self.state.last_evaluated_ms;

        // Latch flips from At rules (replayed in order after downtime) and due one-shots.
        let mut firings: Vec<(i64, String, OnOff, Option<String>)> = Vec::new();
        let replay = last > 0 && now.epoch_ms >= last;
        for profile in &self.state.profiles {
            if replay {
                for f in schedule::at_firings(&profile.config.schedule, last, now, 14) {
                    firings.push((f.at_ms, profile.id.clone(), f.action, None));
                }
            }
            for e in &profile.config.one_shots {
                if e.fired_at_ms.is_none() && e.at_ms <= now.epoch_ms {
                    firings.push((e.at_ms, profile.id.clone(), e.action, Some(e.id.clone())));
                }
            }
        }
        firings.sort_by_key(|f| f.0);
        for (at_ms, profile_id, action, one_shot) in firings {
            let at = now.at(at_ms);
            let source = if one_shot.is_some() { ChangeSource::OneShot } else { ChangeSource::Schedule };
            let Some(profile) = self.state.profile_mut(&profile_id) else { continue };
            if let Some(id) = &one_shot {
                if let Some(e) = profile.config.one_shots.iter_mut().find(|e| &e.id == id) {
                    e.fired_at_ms = Some(at_ms);
                }
            }
            let changed = match action {
                OnOff::On if !profile.latch.is_on() => {
                    profile.latch = Latch::On { since_ms: at_ms, source: if one_shot.is_some() { LatchSource::OneShot } else { LatchSource::AtRule } };
                    true
                }
                OnOff::Off if profile.latch.is_on() => {
                    profile.latch = Latch::Off;
                    true
                }
                _ => false,
            };
            if changed {
                let kind = match action {
                    OnOff::On => JournalKind::ProfileOn { profile_id: profile_id.clone(), source },
                    OnOff::Off => JournalKind::ProfileOff { profile_id: profile_id.clone(), source },
                };
                self.push_journal(&at, false, kind);
            }
            events.push(EngineEvent::ScheduleFired { profile_id, action });
        }

        // Expiry.
        let t = now.epoch_ms;
        let today = now.date_string();
        for u in &mut self.state.pool_usage {
            if u.active_until_ms.is_some_and(|until| until <= t) {
                u.active_until_ms = None;
                events.push(EngineEvent::PoolUnlockExpired { pool: PoolRef { profile_id: u.profile_id.clone(), pool_id: u.pool_id.clone() } });
            }
        }
        self.state.pool_usage.retain(|u| u.local_date == today || u.active_until_ms.is_some());
        self.state.pending_unlocks.retain(|p| p.ready_ms + PENDING_UNLOCK_TTL_MS > t);
        if self.state.overrides.timed.as_ref().is_some_and(|timed| timed.until_ms <= t) {
            self.state.overrides.timed = None;
            self.push_journal(now, false, JournalKind::OverrideEnded { r#override: OverrideKind::Timed });
            events.push(EngineEvent::OverrideEnded { r#override: OverrideKind::Timed });
        }
        self.state.overrides.suppressed.retain(|o| o.end_ms > t);
        self.state.overrides.locked_bypass.retain(|o| o.end_ms > t);
        for profile in &mut self.state.profiles {
            profile.config.one_shots.retain(|e| e.fired_at_ms.is_none_or(|fired| fired + FIRED_ONE_SHOT_RETENTION_MS > t));
        }

        // An override with nothing left to re-enable ends on its own.
        let nothing_suppressed = self.state.overrides.suppressed.is_empty() && self.state.overrides.locked_bypass.is_empty();
        let restored = |prior: &[PriorLatch], profiles: &[Profile]| {
            prior.iter().all(|p| profiles.iter().find(|q| q.id == p.profile_id).is_none_or(|q| q.latch.is_on()))
        };
        if nothing_suppressed {
            if self.state.overrides.all_off.as_ref().is_some_and(|a| restored(&a.prior_latches, &self.state.profiles)) {
                self.state.overrides.all_off = None;
                self.push_journal(now, false, JournalKind::OverrideEnded { r#override: OverrideKind::AllOff });
                events.push(EngineEvent::OverrideEnded { r#override: OverrideKind::AllOff });
            }
            if self
                .state
                .overrides
                .exempt
                .as_ref()
                .is_some_and(|e| e.items.is_empty() && restored(&e.prior_latches, &self.state.profiles))
            {
                self.state.overrides.exempt = None;
                self.push_journal(now, false, JournalKind::OverrideEnded { r#override: OverrideKind::Exempt });
                events.push(EngineEvent::OverrideEnded { r#override: OverrideKind::Exempt });
            }
        }

        // Journal retention: breaking and emergency entries are kept forever.
        self.state
            .journal
            .retain(|e| e.breaks_streak || matches!(e.kind, JournalKind::EmergencyUsed | JournalKind::Migration) || e.at_ms + JOURNAL_RETENTION_MS > t);

        self.state.last_evaluated_ms = t;
        events
    }

    /// Recompute the effective policy, bump the generation on change, and diff activations.
    fn finalize(&mut self, now: &LocalNow) -> Tick {
        let acts = self.activations(now);
        let active: Vec<String> = acts.iter().filter(|a| a.active).map(|a| a.profile_id.clone()).collect();
        if !active.is_empty() && self.state.first_enabled_local_date.is_none() {
            self.state.first_enabled_local_date = Some(now.date_string());
        }
        let mut events = Vec::new();
        for id in &active {
            if !self.last_active.contains(id) {
                events.push(EngineEvent::ProfileActivated { profile_id: id.clone() });
            }
        }
        for id in &self.last_active {
            if !active.contains(id) {
                events.push(EngineEvent::ProfileDeactivated { profile_id: id.clone() });
            }
        }
        self.last_active = active;
        let mut effective = effective::effective(&self.state, now);
        if self.last_layers.as_ref() != Some(&effective.layers) {
            if self.last_layers.is_some() {
                self.state.generation += 1;
            }
            events.push(EngineEvent::EffectiveChanged);
            self.last_layers = Some(effective.layers.clone());
        }
        effective.generation = self.state.generation;
        Tick { effective, next_wake_ms: self.next_wake(now), events }
    }

    fn next_wake(&self, now: &LocalNow) -> i64 {
        let t = now.epoch_ms;
        let mut wake = (t + HOUR_MS).min(now.next_midnight());
        let mut consider = |at: i64| {
            if at > t && at < wake {
                wake = at;
            }
        };
        for profile in &self.state.profiles {
            if let Some(edge) = schedule::next_window_edge(&profile.config.schedule, now) {
                consider(edge);
            }
            if let Some(f) = schedule::next_at_firing(&profile.config.schedule, now) {
                consider(f.at_ms);
            }
            for e in &profile.config.one_shots {
                if e.fired_at_ms.is_none() {
                    consider(e.at_ms.max(t + 1));
                }
            }
        }
        for u in &self.state.pool_usage {
            if let Some(until) = u.active_until_ms {
                consider(until);
            }
        }
        for p in &self.state.pending_unlocks {
            consider(p.ready_ms);
            consider(p.ready_ms + PENDING_UNLOCK_TTL_MS);
        }
        if let Some(timed) = &self.state.overrides.timed {
            consider(timed.until_ms);
        }
        for o in self.state.overrides.suppressed.iter().chain(&self.state.overrides.locked_bypass) {
            consider(o.end_ms);
        }
        wake
    }

    // -----------------------------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------------------------

    pub fn effective(&self, ctx: &Ctx) -> EffectivePolicy {
        let mut e = effective::effective(&self.state, &ctx.now);
        e.generation = self.state.generation;
        e
    }

    /// The flat policy the desktop network layer enforces (identity for one active profile).
    pub fn network_policy(&self, ctx: &Ctx) -> crate::policy::Policy {
        effective::flatten_network(&self.effective(ctx).layers)
    }

    pub fn decide_host(&self, host: &str, ctx: &Ctx) -> Decision {
        effective::decide_host(&self.effective(ctx), host)
    }

    pub fn decide_app(&self, app: &AppRef, ctx: &Ctx) -> Decision {
        effective::decide_app(&self.effective(ctx), app)
    }

    pub fn decide_url(&self, url: &str, extension_capable: bool, ctx: &Ctx) -> Decision {
        effective::decide_url(&self.effective(ctx), url, extension_capable)
    }

    pub fn streak(&self, ctx: &Ctx) -> Streak {
        streak::streak(&self.state, &ctx.now)
    }

    pub fn emergency_left(&self) -> u8 {
        streak::emergency_left(&self.state)
    }

    fn upcoming(&self, now: &LocalNow) -> Vec<UpcomingEvent> {
        let mut out = Vec::new();
        let horizon = now.at(now.epoch_ms + 8 * 24 * HOUR_MS);
        for profile in &self.state.profiles {
            for w in schedule::parsed_windows(&profile.config.schedule) {
                for day in now.day()..=now.day() + 7 {
                    if !w.days.contains(&crate::time::weekday_of_day(day)) || w.start == w.end {
                        continue;
                    }
                    let start = now.epoch_at(day, w.start);
                    let length = if w.start < w.end { w.end - w.start } else { 1440 - w.start + w.end } as i64;
                    let end = start + length * 60_000;
                    if start > now.epoch_ms {
                        out.push(UpcomingEvent { at_ms: start, profile_id: profile.id.clone(), kind: UpcomingKind::WindowStart });
                    }
                    if end > now.epoch_ms && start <= horizon.epoch_ms {
                        out.push(UpcomingEvent { at_ms: end, profile_id: profile.id.clone(), kind: UpcomingKind::WindowEnd });
                    }
                }
            }
            for f in schedule::at_firings(&profile.config.schedule, now.epoch_ms, &horizon, 9) {
                out.push(UpcomingEvent {
                    at_ms: f.at_ms,
                    profile_id: profile.id.clone(),
                    kind: if f.action == OnOff::On { UpcomingKind::On } else { UpcomingKind::Off },
                });
            }
            for e in &profile.config.one_shots {
                if e.fired_at_ms.is_none() && e.at_ms > now.epoch_ms {
                    out.push(UpcomingEvent {
                        at_ms: e.at_ms,
                        profile_id: profile.id.clone(),
                        kind: if e.action == OnOff::On { UpcomingKind::On } else { UpcomingKind::Off },
                    });
                }
            }
        }
        out.sort_by_key(|e| e.at_ms);
        out.dedup();
        out.truncate(8);
        out
    }

    pub fn snapshot(&self, ctx: &Ctx) -> EngineSnapshot {
        let now = &ctx.now;
        let acts = self.activations(now);
        let profiles: Vec<ProfileStatus> = self
            .state
            .profiles
            .iter()
            .zip(acts)
            .map(|(profile, activation)| ProfileStatus {
                committed: activation::is_committed(&self.state, profile, now),
                profile: profile.clone(),
                activation,
            })
            .collect();
        let pools = self
            .state
            .profiles
            .iter()
            .flat_map(|p| p.config.pools.iter().map(move |pool| PoolRef { profile_id: p.id.clone(), pool_id: pool.id.clone() }))
            .filter_map(|r| self.pool_status(&r, now))
            .collect();
        let o = &self.state.overrides;
        EngineSnapshot {
            now_ms: now.epoch_ms,
            generation: self.state.generation,
            any_active: profiles.iter().any(|p| p.activation.active),
            profiles,
            default_profile_id: self.state.default_profile_id.clone(),
            overrides: o.clone(),
            overridden: o.any() || !o.suppressed.is_empty() || !o.locked_bypass.is_empty(),
            pools,
            pending_unlocks: self.state.pending_unlocks.clone(),
            streak: self.streak(ctx),
            emergency_left: self.emergency_left(),
            next_events: self.upcoming(now),
        }
    }

    pub fn popup_info(&self, target: &PopupTarget, ctx: &Ctx) -> PopupInfo {
        let now = &ctx.now;
        let effective = self.effective(ctx);
        let (decision, t, label) = match target {
            PopupTarget::Url { url } => {
                let host = crate::site_catalog::parse_url(url).map(|u| u.host).unwrap_or_default();
                let label = crate::site_catalog::site_for_host(&host).map(|s| s.label.clone()).unwrap_or_else(|| host.clone());
                (effective::decide_url(&effective, url, true), Target::Host(host), label)
            }
            PopupTarget::App { app } => (effective::decide_app(&effective, app), Target::App(app.clone()), app.label.clone()),
        };
        let acts = self.activations(now);
        let mut pools = Vec::new();
        let mut unpooled = Vec::new();
        let mut blocking = Vec::new();
        for id in &decision.blocking_profiles {
            let Some(profile) = self.state.profile(id) else { continue };
            blocking.push(ProfileSummary {
                id: profile.id.clone(),
                name: profile.name.clone(),
                color: profile.color.clone(),
                locked_until_ms: acts.iter().find(|a| a.profile_id == *id).and_then(|a| a.locked_until_ms),
            });
            let pool = profile.config.pools.iter().find(|pool| pool.items.iter().any(|item| effective::item_covers(item, &t)));
            match pool.and_then(|pool| self.pool_status(&PoolRef { profile_id: id.clone(), pool_id: pool.id.clone() }, now)) {
                Some(status) => pools.push(status),
                None => unpooled.push(id.clone()),
            }
        }
        let refs: Vec<PoolRef> = pools.iter().map(|p| PoolRef { profile_id: p.profile_id.clone(), pool_id: p.pool_id.clone() }).collect();
        let friction = pools
            .iter()
            .map(|p| p.friction.clone())
            .max_by_key(|f| f.secs())
            .unwrap_or_default();
        PopupInfo {
            item: decision.item.clone(),
            label,
            unlock_available: !pools.is_empty() && unpooled.is_empty() && pools.iter().all(|p| p.left_today > 0),
            pending: self.pending_for(&refs).cloned(),
            locked_until_ms: blocking.iter().filter_map(|b| b.locked_until_ms).max(),
            verdict: decision.verdict,
            blocking_profiles: blocking,
            pools,
            unpooled_profiles: unpooled,
            friction,
            streak: self.streak(ctx),
            emergency_left: self.emergency_left(),
        }
    }
}
