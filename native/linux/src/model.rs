//! Serde types mirroring packages/shared/src/{policy,schedule,protocol,events}.ts. Field
//! names are camelCase to match the TS wire format exactly.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
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

/// Mirrors `Policy['defaultAction']` in packages/shared/src/policy.ts: the fallback for domains
/// on neither hard list, and the fail-closed/fail-open fallback when a Smart-filtering judge is
/// unreachable (see `Core::sweep_expired_judges`).
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DefaultAction {
    Allow,
    Block,
}

impl Default for DefaultAction {
    /// Matches the old default (`Mode::Blacklist` with empty `domains`, i.e. nothing blocked) so
    /// a brand-new default profile keeps behaving the same as before this migration.
    fn default() -> Self {
        DefaultAction::Allow
    }
}

/// Mirrors `PolicyIntent` in packages/shared/src/policy.ts. Non-null on a `Policy` activates
/// Smart filtering for domains that fall through both hard lists.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Intent {
    pub positive: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub negative: Option<String>,
}

/// Mirrors `Policy` in packages/shared/src/policy.ts. There is no `mode` anymore: `blockedDomains`
/// and `allowedDomains` are independent hard lists (never judged), `defaultAction` decides
/// everything that hits neither list, and `intent` is an optional third layer.
#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    pub blocked_domains: Vec<String>,
    pub allowed_domains: Vec<String>,
    pub default_action: DefaultAction,
    pub intent: Option<Intent>,
    pub apps: Vec<AppRef>,
}

/// Only for backward-compatible deserialization: pre-Smart-filtering policies (persisted state
/// files, or an old client's `setPolicy`/`setProfile` params) used a single `mode` selecting
/// between three preset strategies over a flat `domains` list. Kept private to this module —
/// nothing outside `Policy::deserialize` should ever construct one.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum LegacyMode {
    Blacklist,
    Whitelist,
    BlockAll,
}

/// Permissive wire shape accepting both the current `Policy` fields and the legacy `mode`/
/// `domains` pair, so `Policy::deserialize` can detect which shape it was handed and convert.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PolicyWire {
    #[serde(default)]
    mode: Option<LegacyMode>,
    #[serde(default)]
    domains: Vec<String>,
    #[serde(default)]
    blocked_domains: Vec<String>,
    #[serde(default)]
    allowed_domains: Vec<String>,
    #[serde(default)]
    default_action: Option<DefaultAction>,
    #[serde(default)]
    intent: Option<Intent>,
    #[serde(default)]
    apps: Vec<AppRef>,
}

impl<'de> Deserialize<'de> for Policy {
    /// Detects the legacy `{mode, domains, apps}` shape by the presence of a `mode` key or the
    /// absence of `defaultAction`, and converts: `blacklist` → block only `domains` (open by
    /// default); `whitelist` → allow only `domains` (blocked by default); `block-all` → blocked by
    /// default with no domains on either list. A current-shape payload passes through untouched.
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = PolicyWire::deserialize(deserializer)?;
        let is_legacy = wire.mode.is_some() || wire.default_action.is_none();
        if is_legacy {
            let policy = match wire.mode.unwrap_or(LegacyMode::Blacklist) {
                LegacyMode::Blacklist => Policy {
                    blocked_domains: wire.domains,
                    allowed_domains: Vec::new(),
                    default_action: DefaultAction::Allow,
                    intent: None,
                    apps: wire.apps,
                },
                LegacyMode::Whitelist => Policy {
                    blocked_domains: Vec::new(),
                    allowed_domains: wire.domains,
                    default_action: DefaultAction::Block,
                    intent: None,
                    apps: wire.apps,
                },
                LegacyMode::BlockAll => Policy {
                    blocked_domains: Vec::new(),
                    allowed_domains: Vec::new(),
                    default_action: DefaultAction::Block,
                    intent: None,
                    apps: wire.apps,
                },
            };
            Ok(policy)
        } else {
            Ok(Policy {
                blocked_domains: wire.blocked_domains,
                allowed_domains: wire.allowed_domains,
                default_action: wire.default_action.unwrap_or_default(),
                intent: wire.intent,
                apps: wire.apps,
            })
        }
    }
}

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
}

fn default_true() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            browser_handshake_enabled: false,
            tray_icon_enabled: true,
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
