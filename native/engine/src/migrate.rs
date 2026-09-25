//! One-way upgrade of a v5 desktop daemon state (single active profile + global schedule) into
//! engine state. The daemon keeps a `.v5.bak` copy of the file it read.
//!
//! - every v5 profile keeps its policy (apps stay a block list);
//! - each global schedule window moves onto the profile it named (or the v5 active profile);
//! - focus that the user turned on becomes the active profile's latch, so it stays on after
//!   windows end exactly as before; schedule-started focus stays window-driven;
//! - the v5 active profile becomes the "turn focus on" default.

use serde::Deserialize;

use crate::model::*;
use crate::policy::Policy;
use crate::time::{LocalNow, Weekday};

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct V5Profile {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    color: String,
    #[serde(default)]
    policy: Policy,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct V5Window {
    id: String,
    #[serde(default)]
    days: Vec<String>,
    start: String,
    end: String,
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    locked: bool,
}

#[derive(Deserialize, Default)]
struct V5Schedule {
    #[serde(default)]
    windows: Vec<V5Window>,
}

/// The v5 fields the migration reads (a `PersistentState` after its own v5 migrations ran).
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct V5State {
    #[serde(default)]
    focus_active: bool,
    #[serde(default)]
    focus_source: Option<String>,
    #[serde(default)]
    profiles: Vec<V5Profile>,
    #[serde(default)]
    active_profile_id: String,
    #[serde(default)]
    schedule: V5Schedule,
}

fn weekday(day: &str) -> Option<Weekday> {
    Weekday::ALL.into_iter().find(|w| {
        serde_json::to_value(w).ok().and_then(|v| v.as_str().map(|s| s.eq_ignore_ascii_case(day))).unwrap_or(false)
    })
}

/// Build schema-6 engine state from a v5 state document. `ever_enabled` starts the streak today
/// (the v5 usage log recorded a focus session).
pub fn from_v5(v5: &serde_json::Value, device_id: &str, default_color: &str, ever_enabled: bool, now: &LocalNow) -> EngineState {
    let v5: V5State = serde_json::from_value(v5.clone()).unwrap_or_default();
    let mut state = EngineState::new(device_id);
    for p in v5.profiles {
        state.profiles.push(Profile {
            name: if p.name.trim().is_empty() { "Default".into() } else { p.name },
            color: if p.color.is_empty() { default_color.to_string() } else { p.color },
            created_at_ms: now.epoch_ms,
            config: ProfileConfig { policy: p.policy, ..Default::default() },
            latch: Latch::Off,
            id: p.id,
        });
    }
    if state.profiles.is_empty() {
        state.profiles.push(Profile {
            id: "profile-default".into(),
            name: "Default".into(),
            color: default_color.to_string(),
            created_at_ms: now.epoch_ms,
            config: ProfileConfig::default(),
            latch: Latch::Off,
        });
    }
    let active_id = if state.profile(&v5.active_profile_id).is_some() {
        v5.active_profile_id.clone()
    } else {
        state.profiles[0].id.clone()
    };
    for w in v5.schedule.windows {
        let target = w.profile_id.filter(|id| state.profile(id).is_some()).unwrap_or_else(|| active_id.clone());
        let days = w.days.iter().filter_map(|d| weekday(d)).collect();
        if let Some(profile) = state.profile_mut(&target) {
            profile.config.schedule.push(ScheduleRule::Window { id: w.id, days, start: w.start, end: w.end, locked: w.locked });
        }
    }
    if v5.focus_active && v5.focus_source.as_deref() != Some("schedule") {
        if let Some(profile) = state.profile_mut(&active_id) {
            profile.latch = Latch::On { since_ms: now.epoch_ms, source: LatchSource::Migration };
        }
    }
    state.default_profile_id = Some(active_id);
    if ever_enabled || v5.focus_active {
        state.first_enabled_local_date = Some(now.date_string());
    }
    state.journal_seq = 1;
    state.journal.push(JournalEntry {
        id: format!("{device_id}:1"),
        device_id: device_id.to_string(),
        seq: 1,
        at_ms: now.epoch_ms,
        local_date: now.date_string(),
        breaks_streak: false,
        kind: JournalKind::Migration,
    });
    state.last_evaluated_ms = now.epoch_ms;
    state
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activation;
    use crate::time::{days_from_civil, DAY_MS, HOUR_MS};

    fn monday(h: i64) -> LocalNow {
        LocalNow::new(days_from_civil(2026, 9, 21) * DAY_MS + h * HOUR_MS, 0)
    }

    fn v5(focus: bool, source: &str) -> serde_json::Value {
        serde_json::json!({
            "focusActive": focus,
            "focusSource": source,
            "profiles": [
                { "id": "profile-default", "name": "Default", "color": "test-color-a",
                  "policy": { "blockedDomains": ["reddit.com"], "allowedDomains": [], "defaultAction": "allow", "apps": [] } },
                { "id": "deep", "name": "Deep Work", "color": "test-color-b",
                  "policy": { "mode": "whitelist", "domains": ["docs.rs"], "apps": [] } }
            ],
            "activeProfileId": "profile-default",
            "schedule": { "windows": [
                { "id": "w1", "days": ["mon", "tue"], "start": "09:00", "end": "17:00", "profileId": "deep", "locked": true },
                { "id": "w2", "days": ["sat"], "start": "10:00", "end": "12:00", "locked": false }
            ] },
            "settings": { "browserHandshakeEnabled": true },
            "pairedKeys": []
        })
    }

    #[test]
    fn windows_move_onto_their_profiles_and_user_focus_becomes_a_latch() {
        let state = from_v5(&v5(true, "user"), "dev", "test-color", true, &monday(8));
        assert_eq!(state.profiles.len(), 2);
        let default = state.profile("profile-default").unwrap();
        assert!(default.latch.is_on());
        assert_eq!(default.config.schedule.len(), 1, "unpinned window goes to the v5 active profile");
        let deep = state.profile("deep").unwrap();
        assert!(!deep.latch.is_on());
        assert!(matches!(&deep.config.schedule[0], ScheduleRule::Window { locked: true, days, .. } if days.len() == 2));
        assert_eq!(deep.config.policy.allowed_domains, vec!["docs.rs".to_string()]);
        assert_eq!(state.default_profile_id.as_deref(), Some("profile-default"));
        assert_eq!(state.first_enabled_local_date.as_deref(), Some("2026-09-21"));
        // Monday 10:00: both the latched default and the locked Deep Work window are active.
        let active = activation::active_ids(&state, &monday(10));
        assert_eq!(active, vec!["profile-default".to_string(), "deep".to_string()]);
    }

    #[test]
    fn schedule_started_focus_stays_window_driven() {
        let state = from_v5(&v5(true, "schedule"), "dev", "test-color", false, &monday(10));
        assert!(state.profiles.iter().all(|p| !p.latch.is_on()));
        assert_eq!(activation::active_ids(&state, &monday(10)), vec!["deep".to_string()]);
        assert!(activation::active_ids(&state, &monday(18)).is_empty());
    }

    #[test]
    fn an_empty_document_yields_one_default_profile() {
        let state = from_v5(&serde_json::json!({}), "dev", "test-color", false, &monday(10));
        assert_eq!(state.profiles.len(), 1);
        assert!(state.first_enabled_local_date.is_none());
    }
}
