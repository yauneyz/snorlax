//! Serde types mirroring packages/shared/src/{policy,schedule,protocol,events}.ts. Field
//! names are camelCase to match the TS wire format exactly.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    Blacklist,
    Whitelist,
    BlockAll,
}

impl Default for Mode {
    fn default() -> Self {
        Mode::Blacklist
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRef {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub windows_image_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub linux_process_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub mac_bundle_id: Option<String>,
    pub label: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    #[serde(default)]
    pub mode: Mode,
    #[serde(default)]
    pub domains: Vec<String>,
    #[serde(default)]
    pub apps: Vec<AppRef>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleWindow {
    pub id: String,
    pub days: Vec<String>,
    pub start: String,
    pub end: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub policy_id: Option<String>,
    #[serde(default)]
    pub locked: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    #[serde(default)]
    pub windows: Vec<ScheduleWindow>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedKey {
    pub id: String,
    pub label: String,
    pub serial_ambiguous: bool,
    pub paired_at: u64,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FocusSource {
    User,
    Schedule,
    Boot,
    Recover,
}

impl Default for FocusSource {
    fn default() -> Self {
        FocusSource::Boot
    }
}

/// The authoritative snapshot returned by `getState` and broadcast on changes.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceState {
    pub protocol_version: u32,
    pub service_version: String,
    pub focus_active: bool,
    pub focus_source: FocusSource,
    pub policy: Policy,
    pub schedule: Schedule,
    pub paired_keys: Vec<PairedKey>,
    pub key_present: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub present_key_id: Option<String>,
    pub schedule_locked: bool,
}
