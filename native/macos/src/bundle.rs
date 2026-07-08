//! .app bundle identity for running processes.
//!
//! macOS app identity is the CFBundleIdentifier of the enclosing .app bundle, not the executable
//! name. Helper processes live in nested bundles (e.g. "Google Chrome Helper.app" inside
//! "Google Chrome.app"), so the *innermost* .app ancestor is the right one: its bundle id
//! ("com.google.Chrome.helper") shares the parent browser's prefix, which is what policy and
//! watchdog matching key on.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// The innermost ancestor of `exe` whose name ends in ".app", if any.
pub fn bundle_root(exe: &Path) -> Option<PathBuf> {
    exe.ancestors()
        .skip(1)
        .find(|a| {
            a.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.to_ascii_lowercase().ends_with(".app"))
        })
        .map(Path::to_path_buf)
}

/// CFBundleIdentifier from `<app_root>/Contents/Info.plist`, if readable.
pub fn read_bundle_id(app_root: &Path) -> Option<String> {
    let info = app_root.join("Contents/Info.plist");
    let value: plist::Value = plist::from_file(info).ok()?;
    let dict = value.as_dictionary()?;
    let id = dict.get("CFBundleIdentifier")?.as_string()?;
    let id = id.trim();
    (!id.is_empty()).then(|| id.to_string())
}

/// Bundle id for a process executable path, cached per exe path. Executable paths recur every
/// poll tick and Info.plist parsing is not free; negative results are cached too (bare binaries
/// outside bundles stay bundle-less).
pub fn bundle_id_for_exe(exe: &Path) -> Option<String> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, Option<String>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    {
        let cache = cache.lock().unwrap();
        if let Some(cached) = cache.get(exe) {
            return cached.clone();
        }
    }
    let id = bundle_root(exe).and_then(|root| read_bundle_id(&root));
    let mut cache = cache.lock().unwrap();
    if cache.len() > 4096 {
        cache.clear();
    }
    cache.insert(exe.to_path_buf(), id.clone());
    id
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn innermost_app_ancestor_wins() {
        let exe = Path::new(
            "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/1/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper",
        );
        assert_eq!(
            bundle_root(exe).unwrap(),
            Path::new(
                "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/1/Helpers/Google Chrome Helper.app"
            )
        );
    }

    #[test]
    fn plain_app_and_bare_binary() {
        assert_eq!(
            bundle_root(Path::new("/Applications/Safari.app/Contents/MacOS/Safari")).unwrap(),
            Path::new("/Applications/Safari.app")
        );
        assert_eq!(bundle_root(Path::new("/usr/local/bin/node")), None);
        // A directory literally named "x.app" must be the ancestor, not the exe itself.
        assert_eq!(bundle_root(Path::new("/tmp/fake.app")), None);
    }

    #[test]
    fn reads_bundle_id_from_info_plist() {
        let root = std::env::temp_dir().join(format!(
            "talysman-bundle-test-{}/Fake.app",
            std::process::id()
        ));
        std::fs::create_dir_all(root.join("Contents/MacOS")).unwrap();
        std::fs::write(
            root.join("Contents/Info.plist"),
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>
    <string>com.example.fake</string>
    <key>CFBundleName</key>
    <string>Fake</string>
</dict>
</plist>
"#,
        )
        .unwrap();

        assert_eq!(read_bundle_id(&root).as_deref(), Some("com.example.fake"));
        let exe = root.join("Contents/MacOS/Fake");
        assert_eq!(bundle_id_for_exe(&exe).as_deref(), Some("com.example.fake"));

        let parent = root.parent().unwrap().to_path_buf();
        let _ = std::fs::remove_dir_all(parent);
    }

    #[test]
    fn missing_plist_is_none() {
        assert_eq!(read_bundle_id(Path::new("/nonexistent/Fake.app")), None);
        assert_eq!(bundle_id_for_exe(Path::new("/usr/bin/env")), None);
    }
}
