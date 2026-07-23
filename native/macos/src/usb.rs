//! Removable-drive discovery and paired-key presence for macOS.
//!
//! External volumes appear under /Volumes; the boot volume's entry there is a symlink to /, so
//! symlinks are skipped. The per-volume UUID from `diskutil info` is the primary identity signal
//! (the equivalent of the Windows volume serial); `.talysman/key.bin` is used only when no UUID
//! is available. UUIDs are cached per mount point because presence polls every 3s and diskutil is
//! not free.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

use crate::pairing;
use crate::secure_store::{KeySecret, SecureStore};

const KEY_REL_PATH: &str = ".talysman/key.bin";

#[derive(Clone, Debug)]
pub struct DriveInfo {
    pub id: String,
    pub label: String,
    pub mount_point: String,
    pub serial: Option<String>,
    pub serial_ambiguous: bool,
}

pub fn list_removable_drives() -> Vec<DriveInfo> {
    list_drives_at(&candidate_mounts())
}

/// Build DriveInfo for each candidate mount point that is a real directory (not a symlink —
/// that excludes the boot volume's /Volumes entry). Split out from `list_removable_drives` so
/// tests can point it at temp directories.
fn list_drives_at(mounts: &[PathBuf]) -> Vec<DriveInfo> {
    let mut out = Vec::new();
    for mount in mounts {
        let Ok(meta) = std::fs::symlink_metadata(mount) else {
            continue;
        };
        if !meta.is_dir() || meta.is_symlink() {
            continue;
        }
        let id = mount.to_string_lossy().to_string();
        let label = mount
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("Removable drive")
            .to_string();
        let serial = volume_uuid(mount);
        out.push(DriveInfo {
            id: id.clone(),
            label,
            mount_point: id,
            serial_ambiguous: serial.is_none(),
            serial,
        });
    }
    out.sort_by(|a, b| a.mount_point.cmp(&b.mount_point));
    out.dedup_by(|a, b| a.mount_point == b.mount_point);
    out
}

fn candidate_mounts() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir("/Volumes") {
        for entry in entries.flatten() {
            out.push(entry.path());
        }
    }
    if let Ok(extra) = std::env::var("TALYSMAN_USB_MOUNTS") {
        for path in extra.split(':').filter(|p| !p.trim().is_empty()) {
            out.push(PathBuf::from(path));
        }
    }
    out
}

/// The "Volume UUID" reported by `diskutil info <mount>`, cached per mount point. Entries for
/// mounts that disappear are evicted so a re-inserted drive is re-probed.
fn volume_uuid(mount: &Path) -> Option<String> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, Option<String>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut cache = cache.lock().unwrap();
    cache.retain(|path, _| path.exists());
    if let Some(cached) = cache.get(mount) {
        return cached.clone();
    }
    let uuid = query_volume_uuid(mount);
    cache.insert(mount.to_path_buf(), uuid.clone());
    uuid
}

fn query_volume_uuid(mount: &Path) -> Option<String> {
    let out = Command::new("diskutil")
        .arg("info")
        .arg(mount)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    parse_diskutil_volume_uuid(&String::from_utf8_lossy(&out.stdout))
}

/// Pull the "Volume UUID" value out of `diskutil info` output.
fn parse_diskutil_volume_uuid(output: &str) -> Option<String> {
    for line in output.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        if key.trim() == "Volume UUID" {
            let value = value.trim();
            if value.is_empty() || value.eq_ignore_ascii_case("none") {
                return None;
            }
            return Some(value.to_string());
        }
    }
    None
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

pub fn present_key_ids(store: &SecureStore) -> Vec<String> {
    present_key_ids_at(store, &candidate_mounts())
}

fn present_key_ids_at(store: &SecureStore, mounts: &[PathBuf]) -> Vec<String> {
    let drives = list_drives_at(mounts);
    let mut present = Vec::new();
    for key in &store.keys {
        if drives.iter().any(|d| drive_satisfies(d, key)) {
            present.push(key.id.clone());
        }
    }
    present
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "talysman-usb-test-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn parses_volume_uuid() {
        let output = "\
   Device Identifier:         disk4s1
   Volume Name:               KEYSTICK
   Mounted:                   Yes
   Mount Point:               /Volumes/KEYSTICK
   Volume UUID:               12345678-ABCD-4EF0-9876-543210FEDCBA
";
        assert_eq!(
            parse_diskutil_volume_uuid(output).as_deref(),
            Some("12345678-ABCD-4EF0-9876-543210FEDCBA")
        );
        assert_eq!(parse_diskutil_volume_uuid("Mounted: Yes\n"), None);
        assert_eq!(parse_diskutil_volume_uuid("Volume UUID: \n"), None);
    }

    #[test]
    fn lists_dirs_skipping_symlinks_and_files() {
        let root = temp_root("list");
        let vol = root.join("KEYSTICK");
        std::fs::create_dir(&vol).unwrap();
        std::fs::write(root.join("notes.txt"), "x").unwrap();
        let link = root.join("Macintosh HD");
        std::os::unix::fs::symlink("/", &link).unwrap();

        let drives = list_drives_at(&[vol.clone(), root.join("notes.txt"), link, root.join("gone")]);
        assert_eq!(drives.len(), 1);
        assert_eq!(drives[0].label, "KEYSTICK");
        assert_eq!(drives[0].mount_point, vol.to_string_lossy());
        // diskutil is absent on the Linux test host → no UUID, so ambiguity must be flagged.
        assert!(drives[0].serial_ambiguous == drives[0].serial.is_none());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn key_file_roundtrip_and_presence() {
        let root = temp_root("presence");
        let vol = root.join("KEYSTICK");
        std::fs::create_dir(&vol).unwrap();

        let secret = pairing::generate_secret();
        write_key_file(&vol.to_string_lossy(), &secret).unwrap();
        assert_eq!(read_key_file(&vol.to_string_lossy()).unwrap(), secret);

        let mut store = SecureStore::default();
        store.keys.push(KeySecret {
            id: "key-1".into(),
            secret: Some(pairing::hash_secret(&secret)),
            volume_serial: None,
        });
        assert_eq!(present_key_ids_at(&store, &[vol.clone()]), vec!["key-1"]);

        // Wrong secret on the drive → not present.
        write_key_file(&vol.to_string_lossy(), &pairing::generate_secret()).unwrap();
        assert!(present_key_ids_at(&store, &[vol.clone()]).is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn serial_pinned_key_requires_matching_uuid() {
        let root = temp_root("serial");
        let vol = root.join("KEYSTICK");
        std::fs::create_dir(&vol).unwrap();
        let key = KeySecret {
            id: "key-1".into(),
            secret: None,
            volume_serial: Some("12345678-ABCD-4EF0-9876-543210FEDCBA".into()),
        };
        let matching = DriveInfo {
            id: "matching".into(),
            label: "matching".into(),
            mount_point: vol.to_string_lossy().into(),
            serial: Some("12345678-ABCD-4EF0-9876-543210FEDCBA".into()),
            serial_ambiguous: false,
        };
        let different = DriveInfo {
            serial: Some("different".into()),
            ..matching.clone()
        };
        assert!(drive_satisfies(&matching, &key));
        assert!(!drive_satisfies(&different, &key));

        let _ = std::fs::remove_dir_all(&root);
    }
}
