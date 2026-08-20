//! On-disk locations under %PROGRAMDATA%\Talysman. This directory should have an ACL that
//! denies write to non-admins (set by the installer); the service runs as LocalSystem.

use std::path::PathBuf;

pub fn data_dir() -> PathBuf {
    let base = std::env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".to_string());
    PathBuf::from(base).join("Talysman")
}

pub fn state_file() -> PathBuf {
    data_dir().join("state.json")
}

/// Last known-good copy, rolled over on every `save()` before the new file lands (architecture
/// §7/Phase 7) — `PersistentState::load()` falls back to this if `state.json` fails to parse.
pub fn state_backup_file() -> PathBuf {
    data_dir().join("state.json.bak")
}

/// Scratch file `save()` writes to before the atomic rename into `state_file()`.
pub fn state_tmp_file() -> PathBuf {
    data_dir().join("state.json.tmp")
}

pub fn secure_store_file() -> PathBuf {
    data_dir().join("secure-store.json")
}

pub fn log_file() -> PathBuf {
    data_dir().join("service.log")
}

/// Directory holding the browser native-messaging host manifests (one per browser family, since
/// Chromium and Firefox use different `allowed_*` keys). See enforce::extension_policy.
pub fn nmh_dir() -> PathBuf {
    data_dir().join("nmh")
}

/// Ensure the data directory exists. (ACL hardening is done by the installer.)
pub fn ensure_data_dir() -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir())
}
