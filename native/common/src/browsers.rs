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

use std::path::Path;

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

/// Look up a browser by macOS bundle identifier (case-insensitive). Helper bundles carry the
/// browser's bundle id plus a dotted suffix (e.g. "com.google.Chrome.helper"), so a prefix match
/// on a dot boundary maps every helper to its browser.
pub fn by_mac_bundle(bundle: &str) -> Option<&'static BrowserDef> {
    let bundle = bundle.to_ascii_lowercase();
    BROWSERS
        .iter()
        .find(|b| bundle == b.mac_bundle || bundle.starts_with(&format!("{}.", b.mac_bundle)))
}

/// Look up a Linux browser from every available identity signal, most reliable first:
///
/// 1. The process `comm` name, matched directly — the fast path for ordinary (non-wrapped)
///    installs, where `comm` already is the browser's own name.
/// 2. `/proc/pid/exe`'s basename — resolves through wrapper symlinks/scripts to the real ELF, so
///    it is correct even when both `comm` and argv[0] are wrapper artifacts.
/// 3. argv[0]'s basename — the user-facing command name; a fallback for when `exe` couldn't be
///    read (process already exited, permission denied, sandboxed).
/// 4. `comm` again, this time checked against Nix's `wrapProgram` convention (see
///    [`by_nix_wrapped_comm`]) — a last resort for when neither `exe` nor argv[0] is available.
///
/// Nix-packaged browsers commonly run through a wrapper: `wrapProgram` renames the real binary to
/// `<name>-wrapped` and installs a thin shim at the original name, so the kernel's `comm` for the
/// real process is that wrapped name, truncated to 15 bytes (e.g. Firefox shows up as
/// `.firefox-wrappe`). `exe` sees straight through this because it resolves the actual file the
/// process is running, regardless of what it's named.
pub fn by_linux_process_identity(
    name: &str,
    argv0: Option<&str>,
    exe: Option<&str>,
) -> Option<&'static BrowserDef> {
    by_linux_process(name)
        .or_else(|| exe.and_then(basename).and_then(by_linux_process))
        .or_else(|| argv0.and_then(basename).and_then(by_linux_process))
        .or_else(|| by_nix_wrapped_comm(name))
}

fn basename(path: &str) -> Option<&str> {
    Path::new(path).file_name().and_then(|f| f.to_str())
}

/// Match a `comm` value against Nix's `wrapProgram` convention: the real binary is renamed to
/// `<key>-wrapped` and the kernel truncates `comm` to 15 bytes, so e.g. Firefox's wrapped ELF
/// shows up as `.firefox-wrappe`, and a longer name like Chromium's truncates further still. A
/// match requires `comm` (after stripping a leading `.`) to be a prefix of `<key>-wrapped` *and*
/// at least as long as `<key>` itself — that second condition guarantees the full key was present
/// before truncation, so a short comm can't accidentally match a different, longer browser key.
fn by_nix_wrapped_comm(name: &str) -> Option<&'static BrowserDef> {
    let trimmed = name.strip_prefix('.').unwrap_or(name).to_ascii_lowercase();
    BROWSERS.iter().find(|b| {
        trimmed.len() >= b.linux_process.len()
            && format!("{}-wrapped", b.linux_process).starts_with(&trimmed)
    })
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

    #[test]
    fn mac_bundle_matches_exact_and_helper_suffixes() {
        assert_eq!(
            by_mac_bundle("com.google.Chrome").map(|b| b.key),
            Some("chrome")
        );
        assert_eq!(
            by_mac_bundle("com.google.Chrome.helper").map(|b| b.key),
            Some("chrome")
        );
        assert_eq!(
            by_mac_bundle("org.mozilla.firefox").map(|b| b.key),
            Some("firefox")
        );
        // Prefix must respect the dot boundary — a different product sharing the leading
        // characters is not the same browser.
        assert!(by_mac_bundle("com.google.chromethingy").is_none());
        assert!(by_mac_bundle("com.apple.safari").is_none());
    }

    #[test]
    fn linux_identity_uses_argv0_for_wrapped_browsers() {
        let def = by_linux_process_identity(
            ".firefox-wrappe",
            Some("/etc/profiles/per-user/zac/bin/firefox"),
            None,
        );
        assert_eq!(def.map(|b| b.key), Some("firefox"));
    }

    #[test]
    fn linux_identity_prefers_process_name() {
        let def = by_linux_process_identity("firefox", Some("/usr/bin/not-a-browser"), None);
        assert_eq!(def.map(|b| b.key), Some("firefox"));
    }

    #[test]
    fn linux_identity_uses_exe_for_wrapped_browsers() {
        // No usable argv0 (e.g. it was empty or unreadable) but /proc/pid/exe resolved through
        // the Nix wrapper to the real binary — exe should be enough on its own.
        let def = by_linux_process_identity(
            ".firefox-wrappe",
            None,
            Some("/nix/store/r9ryxxm7nm3qklvh2b3vp0slp3ypd69z-firefox-152.0.4/lib/firefox/firefox"),
        );
        assert_eq!(def.map(|b| b.key), Some("firefox"));
    }

    #[test]
    fn linux_identity_exe_wins_over_misleading_argv0() {
        let def = by_linux_process_identity(
            ".firefox-wrappe",
            Some("/usr/bin/not-a-browser"),
            Some("/nix/store/r9ryxxm7nm3qklvh2b3vp0slp3ypd69z-firefox-152.0.4/lib/firefox/firefox"),
        );
        assert_eq!(def.map(|b| b.key), Some("firefox"));
    }

    #[test]
    fn linux_identity_falls_back_to_wrapped_comm_pattern() {
        // Neither argv0 nor exe was available (e.g. a restricted /proc read) — the wrapped-comm
        // heuristic alone should still recognize Firefox's Nix wrapper naming.
        let def = by_linux_process_identity(".firefox-wrappe", None, None);
        assert_eq!(def.map(|b| b.key), Some("firefox"));

        // A longer key truncates further still; the prefix match must generalize past the
        // one-character truncation Firefox happens to hit.
        let def = by_linux_process_identity(".chromium-wrap", None, None);
        assert_eq!(def.map(|b| b.key), Some("chromium"));
    }

    #[test]
    fn linux_identity_wrapped_comm_does_not_false_positive() {
        // Real-world noise: Spotify is also Nix-wrapped but is not a browser at all, and must
        // not be misclassified just because it shares the wrapper naming convention.
        assert!(by_linux_process_identity(".spotify-wrappe", None, None).is_none());
    }
}
