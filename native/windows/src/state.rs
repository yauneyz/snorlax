//! Authoritative persisted state (architecture §4). Survives restarts so blocking resumes on
//! boot. Secrets/hashes live in secure_store; this file holds the public-ish state.

use std::fs;

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::model::{FocusSource, PairedKey, Policy, Schedule, Settings};
use crate::paths;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistentState {
    #[serde(default)]
    pub focus_active: bool,
    #[serde(default)]
    pub focus_source: FocusSource,
    #[serde(default)]
    pub policy: Policy,
    #[serde(default)]
    pub schedule: Schedule,
    #[serde(default)]
    pub settings: Settings,
    #[serde(default)]
    pub paired_keys: Vec<PairedKey>,
}

impl Default for PersistentState {
    fn default() -> Self {
        PersistentState {
            focus_active: false,
            focus_source: FocusSource::Boot,
            policy: Policy::default(),
            schedule: Schedule::default(),
            settings: Settings::default(),
            paired_keys: Vec::new(),
        }
    }
}

impl PersistentState {
    pub fn load() -> PersistentState {
        match fs::read(paths::state_file()) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
            Err(_) => PersistentState::default(),
        }
    }

    pub fn save(&self) -> Result<()> {
        paths::ensure_data_dir()?;
        let json = serde_json::to_vec_pretty(self)?;
        fs::write(paths::state_file(), json)?;
        Ok(())
    }
}
