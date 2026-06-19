//! Removable-drive discovery and paired-key presence for Linux.
//!
//! v1 uses the `.focuslock/key.bin` secret as the durable proof. Linux volume serial discovery is
//! distro/filesystem-specific, so keys are marked serial-ambiguous until we add udev/lsblk probing.

use std::path::{Path, PathBuf};

use crate::pairing;
use crate::secure_store::{KeySecret, SecureStore};

const KEY_REL_PATH: &str = ".focuslock/key.bin";

#[derive(Clone, Debug)]
pub struct DriveInfo {
    pub id: String,
    pub label: String,
    pub mount_point: String,
    pub serial: Option<String>,
    pub serial_ambiguous: bool,
}

pub fn list_removable_drives() -> Vec<DriveInfo> {
    let mut out = Vec::new();
    for mount in candidate_mounts() {
        let Ok(meta) = std::fs::metadata(&mount) else {
            continue;
        };
        if !meta.is_dir() {
            continue;
        }
        let id = mount.to_string_lossy().to_string();
        let label = mount
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("Removable drive")
            .to_string();
        out.push(DriveInfo {
            id: id.clone(),
            label,
            mount_point: id,
            serial: None,
            serial_ambiguous: true,
        });
    }
    out.sort_by(|a, b| a.mount_point.cmp(&b.mount_point));
    out.dedup_by(|a, b| a.mount_point == b.mount_point);
    out
}

fn candidate_mounts() -> Vec<PathBuf> {
    let mut out = Vec::new();
    collect_two_level(Path::new("/run/media"), &mut out);
    collect_two_level(Path::new("/media"), &mut out);
    collect_one_level(Path::new("/mnt"), &mut out);
    if let Ok(extra) = std::env::var("FOCUSLOCK_USB_MOUNTS") {
        for path in extra.split(':').filter(|p| !p.trim().is_empty()) {
            out.push(PathBuf::from(path));
        }
    }
    out
}

fn collect_two_level(root: &Path, out: &mut Vec<PathBuf>) {
    let Ok(users) = std::fs::read_dir(root) else {
        return;
    };
    for user in users.flatten() {
        let Ok(volumes) = std::fs::read_dir(user.path()) else {
            continue;
        };
        for volume in volumes.flatten() {
            out.push(volume.path());
        }
    }
}

fn collect_one_level(root: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        out.push(entry.path());
    }
}

fn key_file_path(drive_root: &str) -> PathBuf {
    PathBuf::from(drive_root).join(KEY_REL_PATH)
}

pub fn write_key_file(drive_root: &str, secret: &[u8]) -> std::io::Result<()> {
    let path = key_file_path(drive_root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, secret)
}

pub fn read_key_file(drive_root: &str) -> Option<Vec<u8>> {
    std::fs::read(key_file_path(drive_root)).ok()
}

fn drive_satisfies(drive: &DriveInfo, key: &KeySecret) -> bool {
    let Some(secret) = read_key_file(&drive.mount_point) else {
        return false;
    };
    if !pairing::verify_secret(&secret, &key.secret) {
        return false;
    }
    match &key.volume_serial {
        Some(expected) => drive.serial.as_deref() == Some(expected.as_str()),
        None => true,
    }
}

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
