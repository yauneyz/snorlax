// Shared authoritative persisted state. Survives restarts so blocking resumes on boot.

use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Result;
use serde::{Deserialize, Serialize};

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

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistentState {
    #[serde(default)]
    pub focus_active: bool,
    #[serde(default)]
    pub focus_source: FocusSource,
    /// Every blocking profile the user has defined. Never empty after `migrate`.
    #[serde(default)]
    pub profiles: Vec<Profile>,
    /// Which profile focus enforces. Always resolves to a member of `profiles`.
    #[serde(default)]
    pub active_profile_id: String,
    /// Pre-profile state files stored a single bare `policy`. Read once on load and folded into
    /// the default profile by `migrate`; never written back.
    #[serde(default, rename = "policy", skip_serializing)]
    legacy_policy: Option<Policy>,
    #[serde(default)]
    pub schedule: Schedule,
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
}

impl Default for PersistentState {
    fn default() -> Self {
        let profile = Profile::default();
        PersistentState {
            focus_active: false,
            focus_source: FocusSource::Boot,
            active_profile_id: profile.id.clone(),
            profiles: vec![profile],
            legacy_policy: None,
            schedule: Schedule::default(),
            settings: Settings::default(),
            paired_keys: Vec::new(),
            usage_log: Vec::new(),
            usage_seq: 0,
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
        let primary = fs::read(paths::state_file())
            .ok()
            .and_then(|bytes| Self::parse(&bytes, "state.json"));

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
        state.migrate();
        state
    }

    /// Bring a freshly-loaded state up to the current shape: seed a profile from the legacy
    /// single-policy field (or an empty default), repair a dangling active id, and bound the
    /// usage log (it may have grown while this client was offline).
    fn migrate(&mut self) {
        if self.profiles.is_empty() {
            let policy = self.legacy_policy.take().unwrap_or_default();
            self.profiles.push(Profile::from_policy(policy));
        }
        self.legacy_policy = None;
        if !self.profiles.iter().any(|p| p.id == self.active_profile_id) {
            self.active_profile_id = self.profiles[0].id.clone();
        }
        self.prune_usage_log();
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
    /// `afterSeq` cursor stays meaningful even after old entries fall off. Callers already
    /// persist state on their own cadence (e.g. `set_focus`'s `persist_state()`); this does not
    /// save on its own — see architecture §7/Phase 7 on why that's intentional.
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

    /// The profile focus enforces. Falls back to the first profile, which `migrate` guarantees.
    pub fn active_profile(&self) -> &Profile {
        self.profiles
            .iter()
            .find(|p| p.id == self.active_profile_id)
            .unwrap_or(&self.profiles[0])
    }

    /// The policy currently being enforced.
    pub fn active_policy(&self) -> Policy {
        self.active_profile().policy.clone()
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
    use crate::model::{DefaultAction, DEFAULT_PROFILE_ID};

    /// Pre-profile state files stored a single bare `policy` and no profiles at all. That
    /// legacy `policy` also predates `blockedDomains`/`allowedDomains`/`defaultAction`/`intent`:
    /// it used a `mode` + flat `domains` list, which `Policy::deserialize` converts on the fly
    /// (see model.rs) before `migrate` ever sees it.
    #[test]
    fn legacy_policy_becomes_the_default_profile() {
        let legacy = r#"{
            "focusActive": true,
            "focusSource": "user",
            "policy": { "mode": "whitelist", "domains": ["github.com"], "apps": [] },
            "schedule": { "windows": [] },
            "settings": { "browserHandshakeEnabled": true },
            "pairedKeys": []
        }"#;

        let mut state: PersistentState = serde_json::from_str(legacy).unwrap();
        state.migrate();

        assert_eq!(state.profiles.len(), 1);
        assert_eq!(state.profiles[0].id, DEFAULT_PROFILE_ID);
        assert_eq!(state.active_profile_id, DEFAULT_PROFILE_ID);
        // whitelist -> allow only the listed domains, blocked by default.
        assert_eq!(state.active_policy().default_action, DefaultAction::Block);
        assert!(state.active_policy().blocked_domains.is_empty());
        assert_eq!(
            state.active_policy().allowed_domains,
            vec!["github.com".to_string()]
        );
        assert!(state.active_policy().intent.is_none());
        // Unrelated fields survive the migration untouched.
        assert!(state.focus_active);
        assert!(state.settings.browser_handshake_enabled);
    }

    #[test]
    fn an_empty_state_file_still_yields_one_profile() {
        let mut state: PersistentState = serde_json::from_str("{}").unwrap();
        state.migrate();

        assert_eq!(state.profiles.len(), 1);
        assert_eq!(state.active_profile_id, state.profiles[0].id);
    }

    #[test]
    fn a_dangling_active_id_falls_back_to_the_first_profile() {
        let mut state = PersistentState::default();
        state.profiles.push(Profile {
            id: "evening".into(),
            name: "Evening".into(),
            color: "#ff8f6b".into(),
            policy: Policy::default(),
        });
        state.active_profile_id = "deleted".into();
        state.migrate();

        assert_eq!(state.active_profile_id, DEFAULT_PROFILE_ID);
    }

    /// The legacy field is read once and never written back, so a migrated file does not carry
    /// a stale duplicate of the policy alongside the profiles.
    #[test]
    fn the_legacy_policy_field_is_not_reserialized() {
        let mut state: PersistentState =
            serde_json::from_str(r#"{ "policy": { "mode": "block-all" } }"#).unwrap();
        state.migrate();

        let json: serde_json::Value = serde_json::to_value(&state).unwrap();
        assert!(
            json.get("policy").is_none(),
            "top-level policy should be gone"
        );
        // …but it survives where it now belongs, inside the default profile.
        assert_eq!(state.active_policy().default_action, DefaultAction::Block);
        assert!(state.active_policy().blocked_domains.is_empty());
        assert!(state.active_policy().allowed_domains.is_empty());
        assert!(json["profiles"].is_array());
    }

    /// Real-world state files: the pre-profile migration above already happened months ago, so
    /// almost every file on disk has `profiles[].policy` in the *old* `{mode, domains, apps}`
    /// shape, not a top-level `policy`. `Policy::deserialize` must convert those in place too —
    /// this is the shape the Smart-filtering migration actually has to handle in practice.
    #[test]
    fn a_legacy_shaped_policy_inside_an_existing_profile_is_converted() {
        let legacy = r##"{
            "profiles": [
                {
                    "id": "profile-default",
                    "name": "Default",
                    "color": "#4fd6c0",
                    "policy": { "mode": "blacklist", "domains": ["youtube.com"], "apps": [] }
                },
                {
                    "id": "evening",
                    "name": "Evening",
                    "color": "#ff8f6b",
                    "policy": { "mode": "block-all", "domains": [], "apps": [] }
                }
            ],
            "activeProfileId": "profile-default"
        }"##;

        let mut state: PersistentState = serde_json::from_str(legacy).unwrap();
        state.migrate();

        assert_eq!(state.profiles.len(), 2);
        let default = &state.profiles[0].policy;
        assert_eq!(default.default_action, DefaultAction::Allow);
        assert_eq!(default.blocked_domains, vec!["youtube.com".to_string()]);
        assert!(default.allowed_domains.is_empty());
        assert!(default.intent.is_none());

        let evening = &state.profiles[1].policy;
        assert_eq!(evening.default_action, DefaultAction::Block);
        assert!(evening.blocked_domains.is_empty());
        assert!(evening.allowed_domains.is_empty());
    }

    /// A state file already in the current shape (no `mode` key anywhere, `defaultAction`
    /// present) round-trips untouched — the common case going forward.
    #[test]
    fn a_fresh_install_with_no_legacy_mode_key_is_unaffected() {
        let current = r##"{
            "profiles": [
                {
                    "id": "profile-default",
                    "name": "Default",
                    "color": "#4fd6c0",
                    "policy": {
                        "blockedDomains": ["youtube.com"],
                        "allowedDomains": [],
                        "defaultAction": "allow",
                        "intent": { "positive": "finishing my thesis" },
                        "apps": []
                    }
                }
            ],
            "activeProfileId": "profile-default"
        }"##;

        let mut state: PersistentState = serde_json::from_str(current).unwrap();
        state.migrate();

        let policy = state.active_policy();
        assert_eq!(policy.default_action, DefaultAction::Allow);
        assert_eq!(policy.blocked_domains, vec!["youtube.com".to_string()]);
        assert!(policy.allowed_domains.is_empty());
        assert_eq!(
            policy.intent.as_ref().map(|i| i.positive.as_str()),
            Some("finishing my thesis")
        );
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
        let now = now_ms();
        state
            .usage_log
            .push(transition(1, now - MAX_USAGE_LOG_AGE_MS - 1)); // just too old
        state.usage_log.push(transition(2, now - 1_000)); // recent
        state.usage_seq = 2;

        state.migrate();

        assert_eq!(state.usage_log.len(), 1);
        assert_eq!(state.usage_log[0].seq, 2);
    }

    #[test]
    fn migrate_caps_usage_log_at_max_entries_keeping_the_most_recent() {
        let mut state = PersistentState::default();
        let now = now_ms();
        let total = MAX_USAGE_LOG_ENTRIES + 5;
        for i in 0..total {
            state.usage_log.push(transition(i as u64, now));
        }
        state.usage_seq = total as u64;

        state.migrate();

        assert_eq!(state.usage_log.len(), MAX_USAGE_LOG_ENTRIES);
        // The oldest 5 (seq 0..5) should have been dropped; the tail survives.
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

    /// `load()`'s recovery path hinges on `parse` telling corrupt bytes apart from good ones
    /// without panicking — this is the piece that replaces the old bare `unwrap_or_default()`.
    #[test]
    fn parse_returns_none_on_corrupt_bytes_and_some_on_valid_json() {
        assert!(PersistentState::parse(b"not json at all", "test").is_none());
        let valid = serde_json::to_vec(&PersistentState::default()).unwrap();
        assert!(PersistentState::parse(&valid, "test").is_some());
    }
}
