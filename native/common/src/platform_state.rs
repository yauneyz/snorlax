// Shared authoritative persisted state. Survives restarts so blocking resumes on boot.
//
// Schema 6: everything about profiles, schedules, overrides, pools, and the streak lives in
// `engine` (a `talysman_engine::model::EngineState`). The v5 fields (`focusActive`,
// `focusSource`, `profiles`, `activeProfileId`, `schedule`, and the even older bare `policy`) are
// read once to migrate and never written back; the file read at migration is kept as
// `state.v5.json.bak`.

use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Result;
use serde::{Deserialize, Serialize};
use talysman_engine::model::EngineState;
use talysman_engine::time::LocalNow;

use crate::model::{
    FocusSource, PairedKey, Policy, Profile, Schedule, Settings, TransitionKind, UsageTransition,
};
use crate::paths;

/// Exact-usage log retention (architecture §7/Phase 7): whichever bound binds first. This keeps
/// a file bounded even after a client was offline for weeks and comes back with a backlog.
const MAX_USAGE_LOG_ENTRIES: usize = 2000;
const MAX_USAGE_LOG_AGE_MS: u64 = 35 * 24 * 60 * 60 * 1000;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Wall clock plus the local UTC offset, for the engine.
pub fn local_now() -> LocalNow {
    let now = chrono::Local::now();
    LocalNow::new(now.timestamp_millis(), now.offset().local_minus_utc())
}

fn random_device_id() -> String {
    use rand::RngCore;
    let mut b = [0u8; 8];
    rand::thread_rng().fill_bytes(&mut b);
    b.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistentState {
    /// Profiles, schedules, overrides, pools, journal. `None` only in a v5 file before `migrate`.
    #[serde(default)]
    pub engine: Option<EngineState>,
    #[serde(default)]
    pub settings: Settings,
    #[serde(default)]
    pub paired_keys: Vec<PairedKey>,
    /// Exact-usage transition log, drained by the `drainUsage` RPC. Append-only in `seq` order;
    /// pruned to `MAX_USAGE_LOG_ENTRIES`/`MAX_USAGE_LOG_AGE_MS` on every push and on load.
    #[serde(default)]
    pub usage_log: Vec<UsageTransition>,
    /// Monotonically increasing cursor for `usage_log`. Never reset, even when old entries are
    /// pruned, so a client's `afterSeq` stays meaningful across a prune.
    #[serde(default)]
    pub usage_seq: u64,

    // ---- v5 fields: read for migration only ----
    #[serde(default, skip_serializing)]
    focus_active: bool,
    #[serde(default, skip_serializing)]
    focus_source: FocusSource,
    #[serde(default, skip_serializing)]
    profiles: Vec<Profile>,
    #[serde(default, skip_serializing)]
    active_profile_id: String,
    /// Pre-profile state files stored a single bare `policy`.
    #[serde(default, rename = "policy", skip_serializing)]
    legacy_policy: Option<Policy>,
    #[serde(default, skip_serializing)]
    schedule: Schedule,
}

impl Default for PersistentState {
    fn default() -> Self {
        PersistentState {
            engine: None,
            settings: Settings::default(),
            paired_keys: Vec::new(),
            usage_log: Vec::new(),
            usage_seq: 0,
            focus_active: false,
            focus_source: FocusSource::Boot,
            profiles: Vec::new(),
            active_profile_id: String::new(),
            legacy_policy: None,
            schedule: Schedule::default(),
        }
    }
}

impl PersistentState {
    /// Parse a state file, logging and returning `None` on failure rather than the previous
    /// `unwrap_or_default()` — a parse failure now falls through to `.bak` recovery instead of
    /// silently resetting every profile, paired key, and focus state.
    fn parse(bytes: &[u8], label: &str) -> Option<PersistentState> {
        match serde_json::from_slice(bytes) {
            Ok(state) => Some(state),
            Err(error) => {
                tracing::error!("state: {label} failed to parse ({error}); trying fallback");
                None
            }
        }
    }

    pub fn load() -> PersistentState {
        let primary_bytes = fs::read(paths::state_file()).ok();
        let primary = primary_bytes
            .as_deref()
            .and_then(|bytes| Self::parse(bytes, "state.json"));

        let mut state = match primary {
            Some(state) => state,
            None => {
                let backup = fs::read(paths::state_backup_file())
                    .ok()
                    .and_then(|bytes| Self::parse(&bytes, "state.json.bak"));
                match backup {
                    Some(state) => {
                        tracing::warn!("state: recovered from state.json.bak");
                        state
                    }
                    None => PersistentState::default(),
                }
            }
        };
        if state.migrate(&local_now()) {
            if let Some(bytes) = primary_bytes {
                let bak = paths::state_file().with_extension("v5.json.bak");
                if let Err(e) = fs::write(&bak, bytes) {
                    tracing::warn!("state: could not keep the v5 state file at {}: {e}", bak.display());
                }
            }
            tracing::info!("state: migrated to schema 6");
            if let Err(e) = state.save() {
                tracing::error!("state: saving migrated state failed: {e}");
            }
        }
        state
    }

    /// Bring a freshly-loaded state up to the current shape. Returns true when it upgraded a v5
    /// (or older) file into engine state.
    fn migrate(&mut self, now: &LocalNow) -> bool {
        self.prune_usage_log();
        if self.engine.is_some() {
            return false;
        }
        if self.profiles.is_empty() {
            let policy = self.legacy_policy.take().unwrap_or_default();
            self.profiles.push(Profile::from_policy(policy));
        }
        self.legacy_policy = None;
        let v5 = serde_json::json!({
            "focusActive": self.focus_active,
            "focusSource": self.focus_source,
            "profiles": self.profiles,
            "activeProfileId": self.active_profile_id,
            "schedule": self.schedule,
        });
        let ever_enabled = self.focus_active || self.usage_log.iter().any(|t| t.kind == TransitionKind::FocusOn);
        self.engine = Some(talysman_engine::migrate::from_v5(
            &v5,
            &random_device_id(),
            crate::model::DEFAULT_PROFILE_COLOR,
            ever_enabled,
            now,
        ));
        self.profiles.clear();
        self.schedule = Schedule::default();
        true
    }

    /// Engine state; `load` guarantees it is present.
    pub fn engine_state(&self) -> EngineState {
        self.engine.clone().unwrap_or_else(|| EngineState::new(&random_device_id()))
    }

    /// Latch every profile off (an authorized uninstall persisting "focus off").
    pub fn latch_all_off(&mut self) {
        if let Some(engine) = &mut self.engine {
            for profile in &mut engine.profiles {
                profile.latch = talysman_engine::model::Latch::Off;
            }
        }
    }

    /// Enforce `MAX_USAGE_LOG_ENTRIES` / `MAX_USAGE_LOG_AGE_MS`, whichever binds first. Entries
    /// are appended in increasing `seq`/`at` order, so trimming from the front drops the oldest.
    fn prune_usage_log(&mut self) {
        let cutoff = now_ms().saturating_sub(MAX_USAGE_LOG_AGE_MS);
        self.usage_log.retain(|t| t.at >= cutoff);
        if self.usage_log.len() > MAX_USAGE_LOG_ENTRIES {
            let excess = self.usage_log.len() - MAX_USAGE_LOG_ENTRIES;
            self.usage_log.drain(0..excess);
        }
    }

    /// Record one usage transition. `usage_seq` is never reset by pruning, so a client's
    /// `afterSeq` cursor stays meaningful even after old entries fall off. Callers persist state
    /// on their own cadence; this does not save on its own.
    pub fn push_transition(&mut self, kind: TransitionKind, source: FocusSource) {
        self.usage_seq += 1;
        self.usage_log.push(UsageTransition {
            seq: self.usage_seq,
            at: now_ms(),
            kind,
            source,
        });
        self.prune_usage_log();
    }

    /// Write via temp-file + fsync + rename, and roll the previous file to `.bak` first — a
    /// torn write during a plain `fs::write` used to be able to silently reset every paired key
    /// and focus state on the next load; this bounds that window to zero and gives `load()` a
    /// verified-once fallback to recover from.
    pub fn save(&self) -> Result<()> {
        paths::ensure_data_dir()?;
        let json = serde_json::to_vec_pretty(self)?;

        let tmp_path = paths::state_tmp_file();
        let file = fs::File::create(&tmp_path)?;
        {
            use std::io::Write;
            let mut file = &file;
            file.write_all(&json)?;
        }
        file.sync_all()?;
        drop(file);

        if paths::state_file().exists() {
            // Best-effort: losing the `.bak` step still leaves the just-verified tmp file to
            // rename into place, it just costs the recovery fallback for this one save.
            let _ = fs::rename(paths::state_file(), paths::state_backup_file());
        }
        fs::rename(&tmp_path, paths::state_file())?;
        Ok(())
    }
}

#[cfg(test)]
mod migration_tests {
    use super::*;
    use crate::model::{RuleAction, DEFAULT_PROFILE_ID};

    fn now() -> LocalNow {
        LocalNow::new(1_790_000_000_000, 0)
    }

    fn migrated(json: &str) -> PersistentState {
        let mut state: PersistentState = serde_json::from_str(json).unwrap();
        assert!(state.migrate(&now()));
        state
    }

    fn policy_of(state: &PersistentState, id: &str) -> Policy {
        state.engine.as_ref().unwrap().profile(id).unwrap().config.policy.clone()
    }

    /// Pre-profile state files stored a single bare `policy` in the `{mode, domains}` shape.
    #[test]
    fn legacy_policy_becomes_the_default_profile() {
        let state = migrated(
            r#"{
            "focusActive": true,
            "focusSource": "user",
            "policy": { "mode": "whitelist", "domains": ["github.com"], "apps": [] },
            "schedule": { "windows": [] },
            "settings": { "browserHandshakeEnabled": true },
            "pairedKeys": []
        }"#,
        );
        let engine = state.engine.as_ref().unwrap();
        assert_eq!(engine.profiles.len(), 1);
        assert_eq!(engine.profiles[0].id, DEFAULT_PROFILE_ID);
        assert!(engine.profiles[0].latch.is_on(), "user focus becomes a latch");
        let policy = policy_of(&state, DEFAULT_PROFILE_ID);
        assert_eq!(policy.default_action, RuleAction::Block);
        assert_eq!(policy.allowed_domains, vec!["github.com".to_string()]);
        assert!(state.settings.browser_handshake_enabled);
    }

    #[test]
    fn an_empty_state_file_still_yields_one_profile() {
        let state = migrated("{}");
        assert_eq!(state.engine.as_ref().unwrap().profiles.len(), 1);
    }

    /// The v5 fields are read once and never written back.
    #[test]
    fn legacy_fields_are_not_reserialized() {
        let state = migrated(
            r##"{
            "profiles": [
                { "id": "profile-default", "name": "Default", "policy": { "mode": "blacklist", "domains": ["youtube.com"], "apps": [] } },
                { "id": "evening", "name": "Evening", "policy": { "mode": "block-all", "domains": [], "apps": [] } }
            ],
            "activeProfileId": "evening",
            "focusActive": false,
            "schedule": { "windows": [ { "id": "w", "days": ["mon"], "start": "09:00", "end": "17:00", "locked": true } ] }
        }"##,
        );
        let json: serde_json::Value = serde_json::to_value(&state).unwrap();
        for key in ["policy", "profiles", "activeProfileId", "focusActive", "schedule"] {
            assert!(json.get(key).is_none(), "{key} should be gone");
        }
        assert_eq!(policy_of(&state, "evening").default_action, RuleAction::Block);
        let engine = state.engine.as_ref().unwrap();
        assert_eq!(engine.default_profile_id.as_deref(), Some("evening"));
        assert_eq!(engine.profile("evening").unwrap().config.schedule.len(), 1);
        // A second load is a no-op.
        let mut again: PersistentState = serde_json::from_value(json).unwrap();
        assert!(!again.migrate(&now()));
        assert_eq!(again.engine, state.engine);
    }

    #[test]
    fn a_pre_v5_intent_still_migrates_to_a_judge() {
        let state = migrated(
            r##"{
            "profiles": [ { "id": "profile-default", "name": "Default",
                "policy": { "blockedDomains": ["youtube.com"], "allowedDomains": [], "defaultAction": "allow",
                            "intent": { "positive": "finishing my thesis" }, "apps": [] } } ],
            "activeProfileId": "profile-default"
        }"##,
        );
        let policy = policy_of(&state, DEFAULT_PROFILE_ID);
        assert_eq!(policy.default_action, RuleAction::Judge);
        assert_eq!(policy.judge.as_ref().map(|j| j.tasks[0].title.as_str()), Some("finishing my thesis"));
    }

    fn transition(seq: u64, at: u64) -> UsageTransition {
        UsageTransition {
            seq,
            at,
            kind: TransitionKind::FocusOn,
            source: FocusSource::User,
        }
    }

    #[test]
    fn migrate_prunes_usage_log_entries_older_than_35_days() {
        let mut state = PersistentState::default();
        let now_ms = now_ms();
        state
            .usage_log
            .push(transition(1, now_ms - MAX_USAGE_LOG_AGE_MS - 1)); // just too old
        state.usage_log.push(transition(2, now_ms - 1_000)); // recent
        state.usage_seq = 2;

        state.migrate(&now());

        assert_eq!(state.usage_log.len(), 1);
        assert_eq!(state.usage_log[0].seq, 2);
        assert!(state.engine.as_ref().unwrap().first_enabled_local_date.is_some());
    }

    #[test]
    fn migrate_caps_usage_log_at_max_entries_keeping_the_most_recent() {
        let mut state = PersistentState::default();
        let now_ms = now_ms();
        let total = MAX_USAGE_LOG_ENTRIES + 5;
        for i in 0..total {
            state.usage_log.push(transition(i as u64, now_ms));
        }
        state.usage_seq = total as u64;

        state.migrate(&now());

        assert_eq!(state.usage_log.len(), MAX_USAGE_LOG_ENTRIES);
        assert_eq!(state.usage_log.first().unwrap().seq, 5);
        assert_eq!(state.usage_log.last().unwrap().seq, total as u64 - 1);
    }

    #[test]
    fn push_transition_increments_seq_and_never_resets_it_on_prune() {
        let mut state = PersistentState::default();
        state.push_transition(TransitionKind::FocusOn, FocusSource::User);
        state.push_transition(TransitionKind::FocusOff, FocusSource::User);

        assert_eq!(state.usage_seq, 2);
        assert_eq!(state.usage_log.len(), 2);
        assert_eq!(state.usage_log[1].seq, 2);
    }

    #[test]
    fn parse_returns_none_on_corrupt_bytes_and_some_on_valid_json() {
        assert!(PersistentState::parse(b"not json at all", "test").is_none());
        let valid = serde_json::to_vec(&PersistentState::default()).unwrap();
        assert!(PersistentState::parse(&valid, "test").is_some());
    }
}
