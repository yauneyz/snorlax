//! launchd integration: the LaunchDaemon plist and bootstrap/bootout helpers.

use std::path::PathBuf;
use std::process::Command;

pub const LABEL: &str = "app.talysman.svc";
pub const PLIST_PATH: &str = "/Library/LaunchDaemons/app.talysman.svc.plist";

/// The LaunchDaemon plist. RunAtLoad + KeepAlive make launchd both start the daemon on boot and
/// restart it if it dies — the launchd counterpart of the systemd unit's Restart=always.
pub fn plist_text(svc_exe: &str) -> String {
    let exe = xml_escape(svc_exe);
    let log = xml_escape(&crate::paths::data_dir().join("launchd.log").to_string_lossy());
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{exe}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{log}</string>
    <key>StandardErrorPath</key>
    <string>{log}</string>
</dict>
</plist>
"#
    )
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Stop and unload the daemon. Best effort: not loaded is not an error.
pub fn bootout() {
    let _ = Command::new("launchctl")
        .args(["bootout", &format!("system/{LABEL}")])
        .output();
}

/// Load and start the daemon from the installed plist. Falls back to the legacy `load -w` for
/// older macOS where `bootstrap` is unavailable.
pub fn bootstrap() -> std::io::Result<bool> {
    let out = Command::new("launchctl")
        .args(["bootstrap", "system", PLIST_PATH])
        .output()?;
    if out.status.success() {
        return Ok(true);
    }
    let legacy = Command::new("launchctl")
        .args(["load", "-w", PLIST_PATH])
        .output()?;
    Ok(legacy.status.success())
}

pub fn plist_path() -> PathBuf {
    PathBuf::from(PLIST_PATH)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plist_has_label_program_and_keepalive() {
        let text = plist_text("/usr/local/libexec/talysman/talysman-svc");
        assert!(text.contains("<string>app.talysman.svc</string>"));
        assert!(text.contains("<string>/usr/local/libexec/talysman/talysman-svc</string>"));
        assert!(text.contains("<key>RunAtLoad</key>\n    <true/>"));
        assert!(text.contains("<key>KeepAlive</key>\n    <true/>"));
        // Must parse as a real plist.
        let parsed: plist::Value = plist::from_bytes(text.as_bytes()).unwrap();
        let dict = parsed.as_dictionary().unwrap();
        assert_eq!(dict.get("Label").unwrap().as_string(), Some(LABEL));
    }

    #[test]
    fn plist_escapes_xml_metacharacters() {
        let text = plist_text("/Apps/A & B <weird>/talysman-svc");
        assert!(text.contains("/Apps/A &amp; B &lt;weird&gt;/talysman-svc"));
        let parsed: plist::Value = plist::from_bytes(text.as_bytes()).unwrap();
        let args = parsed
            .as_dictionary()
            .unwrap()
            .get("ProgramArguments")
            .unwrap()
            .as_array()
            .unwrap();
        assert_eq!(
            args[0].as_string(),
            Some("/Apps/A & B <weird>/talysman-svc")
        );
    }
}
