//! Constants mirrored from packages/shared/src/constants.ts.

pub const PROTOCOL_VERSION: u32 = 1;
pub const SERVICE_VERSION: &str = env!("CARGO_PKG_VERSION");

pub const SERVICE_NAME: &str = "talysman";
pub const SERVICE_DISPLAY_NAME: &str = "Talysman Enforcement Service";

pub const PIPE_BASE_PROD: &str = "talysman";
pub const PIPE_BASE_DEV: &str = "talysman-dev";

/// Build the macOS Unix-domain socket path from a base name. Production lives under /var/run
/// (root-writable, cleared on boot — the daemon recreates it); dev uses /tmp so an installed
/// daemon and a console daemon do not collide.
pub fn socket_path(base: &str) -> String {
    if base.starts_with('/') {
        return base.to_string();
    }
    if base == PIPE_BASE_PROD {
        "/var/run/talysman/talysman.sock".to_string()
    } else {
        format!("/tmp/{base}.sock")
    }
}

pub mod err {
    pub const KEY_REQUIRED: &str = "KEY_REQUIRED";
    pub const LOCKED: &str = "LOCKED";
    pub const BAD_RECOVERY_CODE: &str = "BAD_RECOVERY_CODE";
    pub const BAD_REQUEST: &str = "BAD_REQUEST";
    pub const INTERNAL: &str = "INTERNAL";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn socket_paths() {
        assert_eq!(
            socket_path(PIPE_BASE_PROD),
            "/var/run/talysman/talysman.sock"
        );
        assert_eq!(socket_path(PIPE_BASE_DEV), "/tmp/talysman-dev.sock");
        assert_eq!(socket_path("/abs/override.sock"), "/abs/override.sock");
    }
}
