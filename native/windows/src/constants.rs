//! Constants mirrored from packages/shared/src/constants.ts. Keep these in sync with the TS
//! side — the pipe name in particular must match what the Electron client connects to.

pub const PROTOCOL_VERSION: u32 = 1;
pub const SERVICE_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Windows service registration name.
pub const SERVICE_NAME: &str = "TalysmanSvc";
pub const SERVICE_DISPLAY_NAME: &str = "Talysman Enforcement Service";

/// Pipe base names (mirror PIPE_BASE_PROD / PIPE_BASE_DEV in TS).
pub const PIPE_BASE_PROD: &str = "talysman";
pub const PIPE_BASE_DEV: &str = "talysman-dev";

/// Build the full Windows named-pipe path from a base name.
pub fn pipe_path(base: &str) -> String {
    format!(r"\\.\pipe\{base}")
}

/// Error codes mirrored from constants.ts ErrorCode.
pub mod err {
    pub const KEY_REQUIRED: &str = "KEY_REQUIRED";
    pub const NO_PAIRED_KEY: &str = "NO_PAIRED_KEY";
    pub const LAST_PAIRED_KEY: &str = "LAST_PAIRED_KEY";
    pub const LOCKED: &str = "LOCKED";
    pub const BAD_RECOVERY_CODE: &str = "BAD_RECOVERY_CODE";
    pub const BAD_REQUEST: &str = "BAD_REQUEST";
    pub const INTERNAL: &str = "INTERNAL";
}
