// Release builds must target macOS (scripts/build-native.mjs enforces a darwin host). The crate
// deliberately compiles on any Unix so its logic and unit tests run on Linux dev boxes and CI;
// the macOS-only edges (pfctl, diskutil, launchctl, /etc/hosts) are plain subprocess/file calls
// that degrade to logged warnings elsewhere.
#[cfg(not(unix))]
compile_error!("native/macos must be built on a Unix host (macOS for release builds).");

pub mod bundle;
pub mod constants;
pub mod core;
pub mod enforce;
pub mod focus_cli;
pub mod ipc;
pub mod launchd;
pub mod model;
pub mod pairing;
pub mod paths;
pub mod policy_match;
pub mod run;
pub mod schedule;
pub mod secure_store;
pub mod service;
pub mod state;
pub mod usb;
