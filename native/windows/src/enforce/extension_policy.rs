//! Force-install + native-messaging registration for the FocusLock browser extension.
//!
//! Why an extension on top of the existing layers: the managed `URLBlocklist` browser policy
//! (enforce::browser_policy) gives Chromium request-layer blocking, but **Firefox is excluded**
//! there (it reads policy only at startup → block-after-unlock). And in any browser, ECH (encrypted
//! SNI) + DoH + pooled/QUIC connection reuse make the host's wire-based IP model go blind. The
//! extension enforces by plaintext URL above TLS via declarativeNetRequest — immune to
//! ECH/QUIC/VPN/connection-reuse — and force-installed it can't be toggled off.
//!
//! Lifecycle differs from browser_policy: this is **persistent**, not focus-toggled. The extension
//! self-gates — it receives the live `{active, mode, domains}` from the service over native
//! messaging (enforce host: focuslock-natmsg.exe) and applies *no* rules while focus is off. So we
//! install once (service startup) and only tear down on a full recover/uninstall — never on a
//! normal focus-off (the extension clears itself when the service pushes `active:false`).
//!
//! All registry writes are HKLM (LocalSystem can write; users can't), mirroring browser_policy.

use std::path::{Path, PathBuf};

use crate::paths::nmh_dir;
use crate::run::run_command;

/// Native-messaging host name. MUST match `HOST_NAME` in the extension's `src/background.js`.
pub const HOST_NAME: &str = "com.focuslock.host";

// --- Packaging-time identities -------------------------------------------------------------------
// These are fixed when the extension is packaged/published. The Chromium ID is the 32-char id
// derived from the packed CRX's public key (stable while the manifest `key` is fixed); the Firefox
// id is `browser_specific_settings.gecko.id`. Keep them in sync with the update/install URLs.
// The Chromium id is derived from the local dev key (apps/extension/keys/chromium.pem) by
// scripts/build-extension.mjs and printed on each build; this value matches that key. Regenerate
// both together if the key changes. TODO(packaging): swap to the published store id + URLs.
pub const CHROMIUM_EXT_ID: &str = "cpemmokfjbiicoaocpmpdeiobnilpokc";
pub const FIREFOX_EXT_ID: &str = "focuslock@focuslock.app";

/// Chromium force-install update manifest. The Web-Store default; for a self-hosted forcelist,
/// point this at our own `update.xml` instead (see the extension README).
pub const CHROMIUM_UPDATE_URL: &str = "https://clients2.google.com/service/update2/crx";

/// Firefox force-install XPI location (a `file://` path to the shipped, signed `.xpi`, or an https
/// URL). TODO(packaging): set to the real signed XPI location.
pub const FIREFOX_XPI_URL: &str = "https://focuslock.app/ext/focuslock.xpi";

/// (policy root, app root) per Chromium browser. The policy root carries
/// `ExtensionInstallForcelist`; the app root carries `NativeMessagingHosts`.
const CHROMIUM_BROWSERS: &[(&str, &str)] = &[
    (
        r"SOFTWARE\Policies\Google\Chrome",
        r"SOFTWARE\Google\Chrome",
    ),
    (
        r"SOFTWARE\Policies\Microsoft\Edge",
        r"SOFTWARE\Microsoft\Edge",
    ),
    (
        r"SOFTWARE\Policies\BraveSoftware\Brave",
        r"SOFTWARE\BraveSoftware\Brave-Browser",
    ),
    (r"SOFTWARE\Policies\Chromium", r"SOFTWARE\Chromium"),
];

/// Locate the shipped native-messaging host exe (sibling of the running service binary).
fn natmsg_exe() -> Option<PathBuf> {
    let cur = std::env::current_exe().ok()?;
    Some(cur.with_file_name("focuslock-natmsg.exe"))
}

/// The native-messaging host manifest for Chromium (uses `allowed_origins`).
fn chromium_manifest(exe: &Path) -> String {
    serde_json::json!({
        "name": HOST_NAME,
        "description": "FocusLock native messaging host",
        "path": exe.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{CHROMIUM_EXT_ID}/")],
    })
    .to_string()
}

/// The native-messaging host manifest for Firefox (uses `allowed_extensions`).
fn firefox_manifest(exe: &Path) -> String {
    serde_json::json!({
        "name": HOST_NAME,
        "description": "FocusLock native messaging host",
        "path": exe.to_string_lossy(),
        "type": "stdio",
        "allowed_extensions": [FIREFOX_EXT_ID],
    })
    .to_string()
}

/// The Chromium `ExtensionInstallForcelist` value: `"<id>;<update_url>"`.
fn forcelist_value() -> String {
    format!("{CHROMIUM_EXT_ID};{CHROMIUM_UPDATE_URL}")
}

/// Install the extension everywhere we can: write the host manifests, register the native host per
/// browser, and force-install (locked) the extension. Idempotent — safe to call on every startup.
pub fn install() {
    let Some(exe) = natmsg_exe() else {
        tracing::warn!("extension_policy: cannot locate focuslock-natmsg.exe; skipping");
        return;
    };
    if let Err(e) = std::fs::create_dir_all(nmh_dir()) {
        tracing::warn!("extension_policy: create nmh dir failed: {e}");
        return;
    }
    let chromium_path = nmh_dir().join("chromium.json");
    let firefox_path = nmh_dir().join("firefox.json");
    if let Err(e) = std::fs::write(&chromium_path, chromium_manifest(&exe)) {
        tracing::warn!("extension_policy: write chromium manifest failed: {e}");
    }
    if let Err(e) = std::fs::write(&firefox_path, firefox_manifest(&exe)) {
        tracing::warn!("extension_policy: write firefox manifest failed: {e}");
    }

    let chromium_manifest_path = chromium_path.to_string_lossy().to_string();
    let forcelist = forcelist_value();
    for (policy_root, app_root) in CHROMIUM_BROWSERS {
        // Register the native messaging host (default value = manifest path).
        reg_set_default(
            &format!(r"HKLM\{app_root}\NativeMessagingHosts\{HOST_NAME}"),
            &chromium_manifest_path,
        );
        // Force-install + lock the extension (the user can't disable a forcelisted extension).
        reg_set_value(
            &format!(r"HKLM\{policy_root}\ExtensionInstallForcelist"),
            "1",
            &forcelist,
        );
    }

    // Firefox: native host under the Mozilla root, force-install via the Extensions Install/Locked
    // policy lists.
    reg_set_default(
        &format!(r"HKLM\SOFTWARE\Mozilla\NativeMessagingHosts\{HOST_NAME}"),
        &firefox_path.to_string_lossy(),
    );
    reg_set_value(
        r"HKLM\SOFTWARE\Policies\Mozilla\Firefox\Extensions\Install",
        "1",
        FIREFOX_XPI_URL,
    );
    reg_set_value(
        r"HKLM\SOFTWARE\Policies\Mozilla\Firefox\Extensions\Locked",
        "1",
        FIREFOX_EXT_ID,
    );
    tracing::info!("extension_policy: force-install + native host registered");
}

/// Remove the force-install and native-host registration (full recover / uninstall only — never on
/// a normal focus-off, which leaves the extension installed and self-gated).
pub fn uninstall() {
    for (policy_root, app_root) in CHROMIUM_BROWSERS {
        reg_delete(&format!(
            r"HKLM\{app_root}\NativeMessagingHosts\{HOST_NAME}"
        ));
        reg_delete_value(
            &format!(r"HKLM\{policy_root}\ExtensionInstallForcelist"),
            "1",
        );
    }
    reg_delete(&format!(
        r"HKLM\SOFTWARE\Mozilla\NativeMessagingHosts\{HOST_NAME}"
    ));
    reg_delete_value(
        r"HKLM\SOFTWARE\Policies\Mozilla\Firefox\Extensions\Install",
        "1",
    );
    reg_delete_value(
        r"HKLM\SOFTWARE\Policies\Mozilla\Firefox\Extensions\Locked",
        "1",
    );
    tracing::info!("extension_policy: force-install + native host removed");
}

fn reg_set_default(key: &str, data: &str) {
    run_command(
        "reg",
        &["add", key, "/ve", "/t", "REG_SZ", "/d", data, "/f"],
        &format!("register native host {key}"),
    );
}

fn reg_set_value(key: &str, name: &str, data: &str) {
    run_command(
        "reg",
        &["add", key, "/v", name, "/t", "REG_SZ", "/d", data, "/f"],
        &format!("set {key}\\{name}"),
    );
}

fn reg_delete(key: &str) {
    run_command("reg", &["delete", key, "/f"], &format!("delete {key}"));
}

fn reg_delete_value(key: &str, name: &str) {
    run_command(
        "reg",
        &["delete", key, "/v", name, "/f"],
        &format!("delete {key}\\{name}"),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn chromium_manifest_has_stdio_and_extension_origin() {
        let m = chromium_manifest(Path::new(
            r"C:\Program Files\FocusLock\focuslock-natmsg.exe",
        ));
        let v: serde_json::Value = serde_json::from_str(&m).unwrap();
        assert_eq!(v["name"], HOST_NAME);
        assert_eq!(v["type"], "stdio");
        assert_eq!(
            v["allowed_origins"][0],
            format!("chrome-extension://{CHROMIUM_EXT_ID}/")
        );
        // Backslashes in the path must be valid JSON (serde escapes them).
        assert!(v["path"].as_str().unwrap().contains("focuslock-natmsg.exe"));
    }

    #[test]
    fn firefox_manifest_uses_allowed_extensions() {
        let m = firefox_manifest(Path::new(r"C:\x\focuslock-natmsg.exe"));
        let v: serde_json::Value = serde_json::from_str(&m).unwrap();
        assert_eq!(v["allowed_extensions"][0], FIREFOX_EXT_ID);
        assert!(v.get("allowed_origins").is_none());
    }

    #[test]
    fn forcelist_value_is_id_semicolon_url() {
        let val = forcelist_value();
        assert!(val.starts_with(CHROMIUM_EXT_ID));
        assert!(val.contains(';'));
        assert!(val.ends_with(CHROMIUM_UPDATE_URL));
    }
}
