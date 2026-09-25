//! Which profiles are active right now, and why.
//!
//! Active ⇔ latch on OR a window occurrence covers now that is neither suppressed by an override
//! nor bypassed by an emergency unlock. A timed override (3) additionally silences everything
//! except profiles held by a live locked window.

use serde::{Deserialize, Serialize};

use crate::model::{EngineState, OnOff, Profile, ScheduleRule, WindowOccurrence};
use crate::schedule;
use crate::time::LocalNow;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Activation {
    pub profile_id: String,
    /// Enforced right now (after overrides).
    pub active: bool,
    pub latched: bool,
    /// Live, unsuppressed window occurrences.
    pub windows: Vec<WindowOccurrence>,
    /// End of the latest-ending live locked occurrence, if any.
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub locked_until_ms: Option<i64>,
    /// Silenced by a timed override (3).
    pub paused: bool,
}

impl Activation {
    pub fn locked(&self) -> bool {
        self.locked_until_ms.is_some()
    }
}

pub fn occurrence_suppressed(state: &EngineState, occ: &WindowOccurrence) -> bool {
    state.overrides.suppressed.iter().any(|s| s.same(occ)) || state.overrides.locked_bypass.iter().any(|s| s.same(occ))
}

/// Live window occurrences for `profile`, including suppressed ones.
pub fn raw_occurrences(profile: &Profile, now: &LocalNow) -> Vec<WindowOccurrence> {
    schedule::live_occurrences(&profile.id, &profile.config.schedule, now)
}

pub fn activation(state: &EngineState, profile: &Profile, now: &LocalNow) -> Activation {
    let windows: Vec<WindowOccurrence> = raw_occurrences(profile, now)
        .into_iter()
        .filter(|occ| !occurrence_suppressed(state, occ))
        .collect();
    let locked_until_ms = windows.iter().filter(|w| w.locked).map(|w| w.end_ms).max();
    let latched = profile.latch.is_on();
    let base = latched || !windows.is_empty();
    let paused = base && locked_until_ms.is_none() && state.overrides.timed.as_ref().is_some_and(|t| t.until_ms > now.epoch_ms);
    Activation {
        profile_id: profile.id.clone(),
        active: base && !paused,
        latched,
        windows,
        locked_until_ms,
        paused,
    }
}

pub fn activations(state: &EngineState, now: &LocalNow) -> Vec<Activation> {
    state.profiles.iter().map(|p| activation(state, p, now)).collect()
}

pub fn active_ids(state: &EngineState, now: &LocalNow) -> Vec<String> {
    activations(state, now).into_iter().filter(|a| a.active).map(|a| a.profile_id).collect()
}

/// Could this profile be enforcing now or later without further user action? Relaxing such a
/// profile's config is key-gated; editing a dormant, unscheduled profile is free.
pub fn is_committed(state: &EngineState, profile: &Profile, now: &LocalNow) -> bool {
    let a = activation(state, profile, now);
    a.latched
        || a.active
        || a.paused
        || profile.config.schedule.iter().any(|rule| match rule {
            ScheduleRule::Window { .. } => true,
            ScheduleRule::At { action, .. } => *action == OnOff::On,
        })
        || profile
            .config
            .one_shots
            .iter()
            .any(|e| e.action == OnOff::On && e.fired_at_ms.is_none() && e.at_ms > now.epoch_ms)
}
