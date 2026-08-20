//! Serde types mirroring packages/shared/src/{policy,schedule,protocol,events}.ts. Field
//! names are camelCase to match the TS wire format exactly.

use serde::{Deserialize, Serialize};

/// The policy model is defined once in `talysman_common::policy` and re-exported here so every
/// backend accepts and emits byte-identical JSON. Re-exported (rather than referenced through
/// its full path) to keep `crate::model::Policy` working for the rest of this crate.
pub use crate::policy::{AppRef, DefaultAction, Intent, Policy};

/// A named policy the user can switch between (mirrors packages/shared/src/profile.ts). Focus
/// enforces exactly one profile at a time; schedule windows may switch which one.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    #[serde(default = "default_profile_color")]
    pub color: String,
    #[serde(default)]
    pub policy: Policy,
}

pub const DEFAULT_PROFILE_ID: &str = "profile-default";
pub const DEFAULT_PROFILE_NAME: &str = "Default";
pub const DEFAULT_PROFILE_COLOR: &str = "#4fd6c0";
/// Mirrors MAX_PROFILE_NAME_LENGTH in packages/shared/src/profile.ts.
pub const MAX_PROFILE_NAME_LENGTH: usize = 40;

fn default_profile_color() -> String {
    DEFAULT_PROFILE_COLOR.to_string()
}

impl Default for Profile {
    fn default() -> Self {
        Profile {
            id: DEFAULT_PROFILE_ID.to_string(),
            name: DEFAULT_PROFILE_NAME.to_string(),
            color: DEFAULT_PROFILE_COLOR.to_string(),
            policy: Policy::default(),
        }
    }
}

impl Profile {
    /// Wrap a bare policy as the default profile (used when migrating pre-profile state).
    pub fn from_policy(policy: Policy) -> Self {
        Profile {
            policy,
            ..Profile::default()
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleWindow {
    pub id: String,
    pub days: Vec<String>,
    pub start: String,
    pub end: String,
    /// Blocking profile this window switches to; `None` keeps whatever is already active.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub profile_id: Option<String>,
    #[serde(default)]
    pub locked: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    #[serde(default)]
    pub windows: Vec<ScheduleWindow>,
}

/// Optional, opt-in enforcement settings (mirrors packages/shared/src/settings.ts).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Browser handshake dead-man's switch. Default off. Turning it off is key-gated.
    #[serde(default)]
    pub browser_handshake_enabled: bool,
    /// Whether the tray helper should show its icon. Purely cosmetic — never key-gated. Default on.
    #[serde(default = "default_true")]
    pub tray_icon_enabled: bool,
    /// Runtime/product capability. Production keeps this false and uses classic filtering.
    #[serde(default)]
    pub smart_filtering_enabled: bool,
}

fn default_true() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            browser_handshake_enabled: false,
            tray_icon_enabled: true,
            smart_filtering_enabled: false,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
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
    #[serde(alias = "recover")]
    User,
    Schedule,
    Boot,
}

impl Default for FocusSource {
    fn default() -> Self {
        FocusSource::Boot
    }
}

/// Mirrors `TransitionKind` in packages/shared/src/protocol.ts (architecture §7/Phase 7).
/// `camelCase` (not `lowercase`) so multi-word variants serialize as `scheduleFired` /
/// `keyPresent` rather than collapsing to one unreadable token.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TransitionKind {
    FocusOn,
    FocusOff,
    ScheduleFired,
    KeyPresent,
    KeyAbsent,
}

/// One entry in the exact-usage transition log (`PersistentState::usage_log`), drained by the
/// `drainUsage` RPC and mirrored by `UsageTransition` in packages/shared/src/protocol.ts.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UsageTransition {
    /// Monotonically increasing per device; the drain cursor.
    pub seq: u64,
    /// Epoch ms.
    pub at: u64,
    pub kind: TransitionKind,
    pub source: FocusSource,
}

/// The authoritative snapshot returned by `getState` and broadcast on changes.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceState {
    pub protocol_version: u32,
    pub service_version: String,
    pub focus_active: bool,
    pub focus_source: FocusSource,
    pub profiles: Vec<Profile>,
    pub active_profile_id: String,
    /// Derived: the active profile's policy — what enforcement actually applies.
    pub policy: Policy,
    pub schedule: Schedule,
    pub settings: Settings,
    pub paired_keys: Vec<PairedKey>,
    pub key_present: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub present_key_id: Option<String>,
    pub schedule_locked: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_recovery_focus_source_migrates_to_user() {
        let source: FocusSource = serde_json::from_str("\"recover\"").unwrap();
        assert_eq!(source, FocusSource::User);
        assert_eq!(serde_json::to_string(&source).unwrap(), "\"user\"");
    }

    #[test]
    fn smart_filtering_is_disabled_by_default() {
        assert!(!Settings::default().smart_filtering_enabled);
    }
}
