//! macOS app blocking via process termination.

use sysinfo::System;

use crate::bundle;
use crate::model::{AppRef, Policy};
use crate::policy_match::blocked_app;

/// Kill every running blocked app; returns the blocklist entries that were closed.
pub fn enforce_snapshot(sys: &System, policy: &Policy) -> Vec<AppRef> {
    let mut closed: Vec<AppRef> = Vec::new();
    for process in sys.processes().values() {
        let name = process.name();
        let bundle_id = process.exe().and_then(bundle::bundle_id_for_exe);
        if let Some(app) = blocked_app(policy, name, bundle_id.as_deref()) {
            if process.kill() {
                tracing::info!("terminated blocked app {name}");
                if !closed.contains(app) {
                    closed.push(app.clone());
                }
            } else {
                tracing::warn!("failed to terminate {name}");
            }
        }
    }
    closed
}
