//! System-wide browser native-messaging registration for Linux.
//!
//! The desktop package installs the browser extension's native host manifest, but never installs
//! or locks the extension itself. Browser-store installation remains under the user's control.

use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

pub use talysman_common::extension_identity::{
    CHROME_STORE_ID as CHROME_EXT_ID, EDGE_STORE_ID as EDGE_EXT_ID,
    FIREFOX_ID as FIREFOX_EXT_ID,
};

pub const HOST_NAME: &str = "com.talysman.host";

const CHROMIUM_MANIFEST_DIRS: &[&str] = &[
    "/etc/opt/chrome/native-messaging-hosts",
    "/etc/opt/chrome_for_testing/native-messaging-hosts",
    "/etc/chromium/native-messaging-hosts",
    "/etc/opt/edge/native-messaging-hosts",
];
const FIREFOX_MANIFEST_DIRS: &[&str] = &["/usr/lib/mozilla/native-messaging-hosts"];

fn natmsg_exe() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .map(|exe| exe.with_file_name("talysman-natmsg"))
}

fn chromium_manifest(exe: &Path) -> String {
    let allowed_origins: Vec<String> = [CHROME_EXT_ID, EDGE_EXT_ID]
        .into_iter()
        .filter(|id| !id.is_empty())
        .map(|id| format!("chrome-extension://{id}/"))
        .collect();
    serde_json::json!({
        "name": HOST_NAME,
        "description": "Talysman native messaging host",
        "path": exe.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": allowed_origins,
    })
    .to_string()
}

fn firefox_manifest(exe: &Path) -> String {
    serde_json::json!({
        "name": HOST_NAME,
        "description": "Talysman native messaging host",
        "path": exe.to_string_lossy(),
        "type": "stdio",
        "allowed_extensions": [FIREFOX_EXT_ID],
    })
    .to_string()
}

fn manifest_path(dir: &str) -> PathBuf {
    Path::new(dir).join(format!("{HOST_NAME}.json"))
}

fn write_manifest(dir: &str, contents: &str) -> io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let path = manifest_path(dir);
    std::fs::write(&path, contents)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o644))
}

/// Register the native host for supported browsers. Idempotent and safe to repair on startup.
pub fn install() {
    let Some(exe) = natmsg_exe() else {
        tracing::warn!("extension_policy: cannot locate talysman-natmsg; skipping");
        return;
    };
    if !exe.is_file() {
        tracing::warn!(
            "extension_policy: native host is missing at {}; skipping",
            exe.display()
        );
        return;
    }

    let chromium = chromium_manifest(&exe);
    for dir in CHROMIUM_MANIFEST_DIRS {
        if let Err(error) = write_manifest(dir, &chromium) {
            tracing::warn!(
                "extension_policy: write {} failed: {error}",
                manifest_path(dir).display()
            );
        }
    }

    let firefox = firefox_manifest(&exe);
    for dir in FIREFOX_MANIFEST_DIRS {
        if let Err(error) = write_manifest(dir, &firefox) {
            tracing::warn!(
                "extension_policy: write {} failed: {error}",
                manifest_path(dir).display()
            );
        }
    }

    if EDGE_EXT_ID.is_empty() {
        tracing::warn!(
            "extension_policy: Edge store id is not configured; the Chrome Web Store build remains allowed"
        );
    }
    tracing::info!("extension_policy: native host registered");
}

/// Remove Talysman's native-host manifests without changing browser extension installations.
pub fn uninstall() {
    for dir in CHROMIUM_MANIFEST_DIRS
        .iter()
        .chain(FIREFOX_MANIFEST_DIRS.iter())
    {
        let path = manifest_path(dir);
        if let Err(error) = std::fs::remove_file(&path) {
            if error.kind() != io::ErrorKind::NotFound {
                tracing::warn!(
                    "extension_policy: remove {} failed: {error}",
                    path.display()
                );
            }
        }
    }
    tracing::info!("extension_policy: native host removed");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chromium_manifest_allows_configured_origins() {
        let manifest = chromium_manifest(Path::new("/opt/Talysman/talysman-natmsg"));
        let value: serde_json::Value = serde_json::from_str(&manifest).unwrap();
        assert_eq!(value["name"], HOST_NAME);
        assert_eq!(value["type"], "stdio");
        assert_eq!(value["path"], "/opt/Talysman/talysman-natmsg");
        let origins = value["allowed_origins"].as_array().unwrap();
        let configured_ids: Vec<&str> = [CHROME_EXT_ID, EDGE_EXT_ID]
            .into_iter()
            .filter(|id| !id.is_empty())
            .collect();
        assert_eq!(origins.len(), configured_ids.len());
        for id in configured_ids {
            assert!(origins
                .iter()
                .any(|origin| origin == &format!("chrome-extension://{id}/")));
        }
    }

    #[test]
    fn firefox_manifest_allows_authored_extension_id() {
        let manifest = firefox_manifest(Path::new("/opt/Talysman/talysman-natmsg"));
        let value: serde_json::Value = serde_json::from_str(&manifest).unwrap();
        assert_eq!(
            value["allowed_extensions"],
            serde_json::json!([FIREFOX_EXT_ID])
        );
        assert!(value.get("allowed_origins").is_none());
    }
}
