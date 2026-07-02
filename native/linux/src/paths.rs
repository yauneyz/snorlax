//! On-disk locations for the Linux service.

use std::path::PathBuf;

pub fn data_dir() -> PathBuf {
    std::env::var("TALYSMAN_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/var/lib/talysman"))
}

pub fn state_file() -> PathBuf {
    data_dir().join("state.json")
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
