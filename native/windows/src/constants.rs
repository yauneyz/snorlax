//! Constants mirrored from packages/shared/src/constants.ts. Keep these in sync with the TS
//! side — the pipe name in particular must match what the Electron client connects to.

pub const PROTOCOL_VERSION: u32 = 1;
pub const SERVICE_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Windows service registration name.
pub const SERVICE_NAME: &str = "FocusLockSvc";
pub const SERVICE_DISPLAY_NAME: &str = "FocusLock Enforcement Service";

/// Pipe base names (mirror PIPE_BASE_PROD / PIPE_BASE_DEV in TS).
pub const PIPE_BASE_PROD: &str = "focuslock";
pub const PIPE_BASE_DEV: &str = "focuslock-dev";

/// Build the full Windows named-pipe path from a base name.
pub fn pipe_path(base: &str) -> String {
    format!(r"\\.\pipe\{base}")
}

/// Upstream DNS used by the sinkhole to resolve *allowed* domains.
pub const UPSTREAM_DNS: &str = "1.1.1.1:53";

/// Loopback address the sinkhole binds to and adapters are pointed at.
pub const SINKHOLE_ADDR: &str = "127.0.0.1:53";

/// Error codes mirrored from constants.ts ErrorCode.
pub mod err {
    pub const KEY_REQUIRED: &str = "KEY_REQUIRED";
    pub const LOCKED: &str = "LOCKED";
    pub const BAD_RECOVERY_CODE: &str = "BAD_RECOVERY_CODE";
    pub const BAD_REQUEST: &str = "BAD_REQUEST";
    pub const INTERNAL: &str = "INTERNAL";
}
