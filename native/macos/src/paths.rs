//! On-disk locations for the macOS daemon.

use std::path::PathBuf;

pub fn data_dir() -> PathBuf {
    std::env::var("TALYSMAN_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/Library/Application Support/Talysman"))
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

pub fn recovery_code_file() -> PathBuf {
    data_dir().join("recovery-code.txt")
}

pub fn log_file() -> PathBuf {
    data_dir().join("service.log")
}

pub fn ensure_data_dir() -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir())
}
