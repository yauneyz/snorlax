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
}
