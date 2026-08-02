//! Authoritative persisted state (architecture §4). Survives restarts so blocking resumes on
//! boot. Secrets/hashes live in secure_store; this file holds the public-ish state.

use std::fs;

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::model::{FocusSource, PairedKey, Policy, Profile, Schedule, Settings};
use crate::paths;

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
        }
    }
}

impl PersistentState {
    pub fn load() -> PersistentState {
        let mut state = match fs::read(paths::state_file()) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
            Err(_) => PersistentState::default(),
        };
        state.migrate();
        state
    }

    /// Bring a freshly-loaded state up to the current shape: seed a profile from the legacy
    /// single-policy field (or an empty default) and repair a dangling active id.
    fn migrate(&mut self) {
        if self.profiles.is_empty() {
            let policy = self.legacy_policy.take().unwrap_or_default();
            self.profiles.push(Profile::from_policy(policy));
        }
        self.legacy_policy = None;
        if !self.profiles.iter().any(|p| p.id == self.active_profile_id) {
            self.active_profile_id = self.profiles[0].id.clone();
        }
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

    pub fn save(&self) -> Result<()> {
        paths::ensure_data_dir()?;
        let json = serde_json::to_vec_pretty(self)?;
        fs::write(paths::state_file(), json)?;
        Ok(())
    }
}

#[cfg(test)]
mod migration_tests {
    use super::*;
    use crate::model::{Mode, DEFAULT_PROFILE_ID};

    /// Pre-profile state files stored a single bare `policy` and no profiles at all.
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
        assert_eq!(state.active_policy().mode, Mode::Whitelist);
        assert_eq!(state.active_policy().domains, vec!["github.com".to_string()]);
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
        assert!(json.get("policy").is_none(), "top-level policy should be gone");
        // …but it survives where it now belongs, inside the default profile.
        assert_eq!(state.active_policy().mode, Mode::BlockAll);
        assert!(json["profiles"].is_array());
    }
}
