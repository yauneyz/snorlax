//! Browser classification shared by every backend's watchdog.
//!
//! A *supported* browser is one we ship the extension for; during a locked session it must keep
//! proving the extension is alive (heartbeats). An *unsupported* browser is a known browser binary
//! that cannot host our extension (alternative forks); during a locked session it is a bypass route
//! and is closed outright.
//!
//! Note on coverage: many privacy/portable browsers reuse a supported image name — Tor Browser runs
//! as `firefox`, a portable Chrome as `chrome`. Those are intentionally **not** listed here: the
//! watchdog catches them through the heartbeat path instead (a `firefox`/`chrome` root process that
//! never sends a healthy heartbeat is treated as a supported browser missing its extension and is
//! closed). The unsupported list only needs the forks that carry a *distinct* binary name.

/// Whether a browser can host the Talysman extension.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BrowserClass {
    /// We ship the extension for it; it must prove the extension is alive via heartbeats.
    Supported,
    /// A known browser that cannot run our extension. During a locked session it is closed.
    Unsupported,
}

/// One row of the classification table. Names are matched case-insensitively.
pub struct BrowserDef {
    /// Stable key used in events/logs, e.g. "chrome".
    pub key: &'static str,
    pub class: BrowserClass,
    /// Windows image name including extension, lower-case (e.g. "chrome.exe").
    pub windows_image: &'static str,
    /// Linux process/comm name, lower-case (e.g. "chrome").
    pub linux_process: &'static str,
    /// macOS bundle id, for the future macOS backend (e.g. "com.google.Chrome").
    pub mac_bundle: &'static str,
}

/// The classification table. Supported browsers first, then known-unsupported forks.
pub const BROWSERS: &[BrowserDef] = &[
    // --- Supported (extension-capable) ---
    BrowserDef {
        key: "chrome",
        class: BrowserClass::Supported,
        windows_image: "chrome.exe",
        linux_process: "chrome",
        mac_bundle: "com.google.chrome",
    },
    BrowserDef {
        key: "edge",
        class: BrowserClass::Supported,
        windows_image: "msedge.exe",
        linux_process: "msedge",
        mac_bundle: "com.microsoft.edgemac",
    },
    BrowserDef {
        key: "brave",
        class: BrowserClass::Supported,
        windows_image: "brave.exe",
        linux_process: "brave",
        mac_bundle: "com.brave.browser",
    },
    BrowserDef {
        key: "vivaldi",
        class: BrowserClass::Supported,
        windows_image: "vivaldi.exe",
        linux_process: "vivaldi",
        mac_bundle: "com.vivaldi.vivaldi",
    },
    BrowserDef {
        key: "opera",
        class: BrowserClass::Supported,
        windows_image: "opera.exe",
        linux_process: "opera",
        mac_bundle: "com.operasoftware.opera",
    },
    BrowserDef {
        key: "chromium",
        class: BrowserClass::Supported,
        windows_image: "chromium.exe",
        linux_process: "chromium",
        mac_bundle: "org.chromium.chromium",
    },
    BrowserDef {
        key: "firefox",
        class: BrowserClass::Supported,
        windows_image: "firefox.exe",
        linux_process: "firefox",
        mac_bundle: "org.mozilla.firefox",
    },
    // --- Known-unsupported (distinct binary, cannot host the extension) ---
    BrowserDef {
        key: "librewolf",
        class: BrowserClass::Unsupported,
        windows_image: "librewolf.exe",
        linux_process: "librewolf",
        mac_bundle: "io.gitlab.librewolf-community",
    },
    BrowserDef {
        key: "waterfox",
        class: BrowserClass::Unsupported,
        windows_image: "waterfox.exe",
        linux_process: "waterfox",
        mac_bundle: "net.waterfox.waterfox",
    },
    BrowserDef {
        key: "floorp",
        class: BrowserClass::Unsupported,
        windows_image: "floorp.exe",
        linux_process: "floorp",
        mac_bundle: "one.ablaze.floorp",
    },
    BrowserDef {
        key: "mullvad",
        class: BrowserClass::Unsupported,
        windows_image: "mullvad browser.exe",
        linux_process: "mullvadbrowser",
        mac_bundle: "net.mullvad.mullvadbrowser",
    },
];

/// Look up a browser by Windows image name (case-insensitive).
pub fn by_windows_image(image: &str) -> Option<&'static BrowserDef> {
    let image = image.to_ascii_lowercase();
    BROWSERS.iter().find(|b| b.windows_image == image)
}

/// Look up a browser by Linux process name (case-insensitive).
pub fn by_linux_process(name: &str) -> Option<&'static BrowserDef> {
    let name = name.to_ascii_lowercase();
    BROWSERS.iter().find(|b| b.linux_process == name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_supported_and_unsupported() {
        assert_eq!(
            by_windows_image("CHROME.EXE").map(|b| b.class),
            Some(BrowserClass::Supported)
        );
        assert_eq!(
            by_linux_process("firefox").map(|b| b.class),
            Some(BrowserClass::Supported)
        );
        assert_eq!(
            by_windows_image("librewolf.exe").map(|b| b.class),
            Some(BrowserClass::Unsupported)
        );
        assert!(by_windows_image("notepad.exe").is_none());
    }
}
