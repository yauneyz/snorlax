//! Native-messaging registration for the user-installed FocusLock browser extension.
//!
//! The extension is the browser request-layer blocker: it receives live `{active, mode, domains}`
//! state over native messaging (host: focuslock-natmsg.exe) and applies declarativeNetRequest rules
//! above TLS, so ECH/QUIC/VPN/connection reuse do not hide requests from it.
//!
//! Lifecycle is persistent, not focus-toggled. We register the local native host at service startup
//! and remove that registration on a full recover/uninstall. Browser installation remains under the
//! user's control through each browser's official extension store.
//!
//! All registry writes are HKLM (LocalSystem can write; users cannot). We also clear legacy
//! URLBlocklist/URLAllowlist policy keys from older builds; current request-layer blocking lives
//! entirely in the extension.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::paths::nmh_dir;
use crate::run::run_command;

/// Native-messaging host name. MUST match `HOST_NAME` in the extension's `src/background.js`.
pub const HOST_NAME: &str = "com.focuslock.host";

// --- Packaging-time identities -------------------------------------------------------------------
// Chrome and Edge assign separate IDs when their store items are first created. Leave these empty
// until the first submissions exist, then copy the store IDs here. They are used only to restrict
// which store extensions may launch the native host; they are not used to install extensions.
pub const CHROME_EXT_ID: &str = "";
pub const EDGE_EXT_ID: &str = "";

// Firefox uses the authored Gecko ID in manifest.json, including for AMO-listed builds.
pub const FIREFOX_EXT_ID: &str = "focuslock@focuslock.app";

const LEGACY_CHROMIUM_FORCELIST_VALUE: &str =
    "cpemmokfjbiicoaocpmpdeiobnilpokc;https://focuslock.app/ext/chromium/updates.xml";
const LEGACY_FIREFOX_XPI_URL: &str = "https://focuslock.app/ext/firefox/focuslock-0.1.0.xpi";
const LEGACY_FIREFOX_AMO_URL: &str =
    "https://addons.mozilla.org/firefox/downloads/latest/focuslock@focuslock.app/latest.xpi";

/// (browser, policy root, app root, store extension ID) per Chromium browser. The policy root is
/// retained only to remove FocusLock values written by older releases.
const CHROMIUM_BROWSERS: &[(&str, &str, &str, &str)] = &[
    (
        "Chrome",
        r"SOFTWARE\Policies\Google\Chrome",
        r"SOFTWARE\Google\Chrome",
        CHROME_EXT_ID,
    ),
    (
        "Edge",
        r"SOFTWARE\Policies\Microsoft\Edge",
        r"SOFTWARE\Microsoft\Edge",
        EDGE_EXT_ID,
    ),
    (
        "Brave",
        r"SOFTWARE\Policies\BraveSoftware\Brave",
        r"SOFTWARE\BraveSoftware\Brave-Browser",
        CHROME_EXT_ID,
    ),
    (
        "Chromium",
        r"SOFTWARE\Policies\Chromium",
        r"SOFTWARE\Chromium",
        CHROME_EXT_ID,
    ),
];

/// Locate the shipped native-messaging host exe (sibling of the running service binary).
fn natmsg_exe() -> Option<PathBuf> {
    let cur = std::env::current_exe().ok()?;
    Some(cur.with_file_name("focuslock-natmsg.exe"))
}

/// The native-messaging host manifest for Chromium (uses `allowed_origins`).
fn chromium_manifest(exe: &Path) -> String {
    let allowed_origins: Vec<String> = [CHROME_EXT_ID, EDGE_EXT_ID]
        .into_iter()
        .filter(|id| !id.is_empty())
        .map(|id| format!("chrome-extension://{id}/"))
        .collect();
    serde_json::json!({
        "name": HOST_NAME,
        "description": "FocusLock native messaging host",
        "path": exe.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": allowed_origins,
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

/// Write and register the native host for each browser. Idempotent — safe to call on every startup.
/// Extension installation is deliberately not performed here: consumer browser-store installs must
/// remain user initiated and removable through the browser's normal controls.
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
    for (browser, _, app_root, extension_id) in CHROMIUM_BROWSERS {
        // Register the native messaging host (default value = manifest path).
        reg_set_default(
            &format!(r"HKLM\{app_root}\NativeMessagingHosts\{HOST_NAME}"),
            &chromium_manifest_path,
        );
        if extension_id.is_empty() {
            tracing::warn!(
                "extension_policy: {browser} store id is not configured; native messaging is unavailable"
            );
        }
    }

    // Firefox uses the same user-installed companion model. The authored Gecko ID restricts the
    // native host to the official AMO build.
    reg_set_default(
        &format!(r"HKLM\SOFTWARE\Mozilla\NativeMessagingHosts\{HOST_NAME}"),
        &firefox_path.to_string_lossy(),
    );
    remove_focuslock_managed_install_policies();
    clear_legacy_request_policies();
    tracing::info!("extension_policy: native host registered");
}

/// Remove native-host registration on full recover / uninstall. The store extension remains under
/// the user's control and can be removed using the browser UI.
pub fn uninstall() {
    for (_, _, app_root, _) in CHROMIUM_BROWSERS {
        reg_delete(&format!(
            r"HKLM\{app_root}\NativeMessagingHosts\{HOST_NAME}"
        ));
    }
    reg_delete(&format!(
        r"HKLM\SOFTWARE\Mozilla\NativeMessagingHosts\{HOST_NAME}"
    ));
    remove_focuslock_managed_install_policies();
    clear_legacy_request_policies();
    tracing::info!("extension_policy: native host removed");
}

/// Remove only policy values known to have been written by FocusLock. List-policy value names are
/// shared with administrators, so deleting value `1` unconditionally could remove unrelated policy.
fn remove_focuslock_managed_install_policies() {
    let chromium_values = [LEGACY_CHROMIUM_FORCELIST_VALUE, CHROME_EXT_ID, EDGE_EXT_ID];
    for (_, policy_root, _, _) in CHROMIUM_BROWSERS {
        reg_delete_value_if_matches(
            &format!(r"HKLM\{policy_root}\ExtensionInstallForcelist"),
            "1",
            &chromium_values,
        );
    }
    reg_delete_value_if_matches(
        r"HKLM\SOFTWARE\Policies\Mozilla\Firefox\Extensions\Install",
        "1",
        &[LEGACY_FIREFOX_XPI_URL, LEGACY_FIREFOX_AMO_URL],
    );
    reg_delete_value_if_matches(
        r"HKLM\SOFTWARE\Policies\Mozilla\Firefox\Extensions\Locked",
        "1",
        &[FIREFOX_EXT_ID],
    );
}

fn clear_legacy_request_policies() {
    for (_, policy_root, _, _) in CHROMIUM_BROWSERS {
        reg_delete(&format!(r"HKLM\{policy_root}\URLBlocklist"));
        reg_delete(&format!(r"HKLM\{policy_root}\URLAllowlist"));
        reg_delete_value(&format!(r"HKLM\{policy_root}"), "DnsOverHttpsMode");
        reg_delete_value(&format!(r"HKLM\{policy_root}"), "BuiltInDnsClientEnabled");
    }
    reg_delete(r"HKLM\SOFTWARE\Policies\Mozilla\Firefox\WebsiteFilter");
}

fn reg_set_default(key: &str, data: &str) {
    run_command(
        "reg",
        &["add", key, "/ve", "/t", "REG_SZ", "/d", data, "/f"],
        &format!("register native host {key}"),
    );
}

fn reg_delete(key: &str) {
    run_command("reg", &["delete", key, "/f"], &format!("delete {key}"));
}

fn parse_reg_sz(stdout: &str) -> Option<&str> {
    stdout.lines().find_map(|line| {
        let (_, data) = line.split_once("REG_SZ")?;
        let data = data.trim();
        (!data.is_empty()).then_some(data)
    })
}

fn reg_delete_value_if_matches(key: &str, name: &str, expected: &[&str]) {
    let Ok(output) = Command::new("reg")
        .args(["query", key, "/v", name])
        .output()
    else {
        return;
    };
    if !output.status.success() {
        return;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let Some(value) = parse_reg_sz(&stdout) else {
        return;
    };
    if expected
        .iter()
        .any(|candidate| !candidate.is_empty() && *candidate == value)
    {
        reg_delete_value(key, name);
    }
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
    fn chromium_manifest_has_stdio_and_configured_store_origins() {
        let m = chromium_manifest(Path::new(
            r"C:\Program Files\FocusLock\focuslock-natmsg.exe",
        ));
        let v: serde_json::Value = serde_json::from_str(&m).unwrap();
        assert_eq!(v["name"], HOST_NAME);
        assert_eq!(v["type"], "stdio");
        let origins = v["allowed_origins"].as_array().unwrap();
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
    fn parses_registry_string_values() {
        let output = r#"
HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist
    1    REG_SZ    abcdefghijklmnop
"#;
        assert_eq!(parse_reg_sz(output), Some("abcdefghijklmnop"));
    }
}
