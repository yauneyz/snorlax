//! Removable-drive enumeration + paired-key presence detection (architecture §5).
//!
//! v1 identifies a key by its volume serial number. `.talysman/key.bin` is used only when a
//! volume exposes no serial. Reading USB (VID,PID,serial) via SetupAPI is a possible identity
//! upgrade; volume serial needs far less FFI and is sufficient for the product's trust model.
//!
//! Presence is recomputed by polling (~3s, in core.rs). A WM_DEVICECHANGE event window is a
//! latency optimization left as a TODO.

use std::path::PathBuf;

use crate::pairing;
use crate::secure_store::{KeySecret, SecureStore};

use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::{GetDriveTypeW, GetVolumeInformationW};

const KEY_REL_PATH: &str = r".talysman\key.bin";
const DRIVE_REMOVABLE: u32 = 2;

#[derive(Clone, Debug)]
pub struct DriveInfo {
    /// Stable-ish id for the picker (we use the root path, e.g. "E:\\").
    pub id: String,
    pub label: String,
    pub mount_point: String,
    /// Volume serial as hex, if available.
    pub serial: Option<String>,
    pub serial_ambiguous: bool,
}

fn to_wide_nul(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Root path for a drive letter, e.g. 'E' -> "E:\\".
fn root_path(letter: u8) -> String {
    format!("{}:\\", letter as char)
}

fn volume_serial(root: &str) -> Option<u32> {
    let wide = to_wide_nul(root);
    let mut serial: u32 = 0;
    // SAFETY: `wide` is a valid null-terminated UTF-16 string for the call's lifetime.
    let ok = unsafe {
        GetVolumeInformationW(
            PCWSTR(wide.as_ptr()),
            None,
            Some(&mut serial as *mut u32),
            None,
            None,
            None,
        )
    };
    match ok {
        Ok(()) if serial != 0 => Some(serial),
        _ => None,
    }
}

fn is_removable(root: &str) -> bool {
    let wide = to_wide_nul(root);
    // SAFETY: valid null-terminated UTF-16 root path.
    let kind = unsafe { GetDriveTypeW(PCWSTR(wide.as_ptr())) };
    kind == DRIVE_REMOVABLE
}

/// Enumerate currently-connected removable drives (probe letters A..Z).
pub fn list_removable_drives() -> Vec<DriveInfo> {
    let mut out = Vec::new();
    for letter in b'A'..=b'Z' {
        let root = root_path(letter);
        if !std::path::Path::new(&root).exists() {
            continue;
        }
        if !is_removable(&root) {
            continue;
        }
        let serial = volume_serial(&root);
        out.push(DriveInfo {
            id: root.clone(),
            label: format!("Removable drive ({}:)", letter as char),
            mount_point: root,
            serial: serial.map(|s| format!("{s:08X}")),
            serial_ambiguous: serial.is_none(),
        });
    }
    out
}

fn key_file_path(drive_root: &str) -> PathBuf {
    PathBuf::from(drive_root).join(KEY_REL_PATH)
}

/// Write the pairing secret to <drive>\.talysman\key.bin.
pub fn write_key_file(drive_root: &str, secret: &[u8]) -> std::io::Result<()> {
    let path = key_file_path(drive_root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, secret)
}

/// Read the secret stored on a drive, if present.
pub fn read_key_file(drive_root: &str) -> Option<Vec<u8>> {
    std::fs::read(key_file_path(drive_root)).ok()
}

/// Match by stable identifier when available; use key.bin only as the no-identifier fallback.
fn drive_satisfies(drive: &DriveInfo, key: &KeySecret) -> bool {
    match &key.volume_serial {
        Some(expected) => drive.serial.as_deref() == Some(expected.as_str()),
        None => {
            let (Some(secret), Some(stored)) =
                (read_key_file(&drive.mount_point), key.secret.as_ref())
            else {
                return false;
            };
            pairing::verify_secret(&secret, stored)
        }
    }
}

/// Returns the ids of paired keys that are physically present right now.
pub fn present_key_ids(store: &SecureStore) -> Vec<String> {
    let drives = list_removable_drives();
    let mut present = Vec::new();
    for key in &store.keys {
        if drives.iter().any(|d| drive_satisfies(d, key)) {
            present.push(key.id.clone());
        }
    }
    present
}
