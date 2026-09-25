//! Linux app blocking via process termination.

use sysinfo::System;

use crate::model::{AppRef, Policy};
use crate::policy_match::blocked_app;

/// Enforce the app policy against an already-refreshed process snapshot. The browser watchdog
/// owns the single process scan shared by both protections.
/// Returns the blocklist entries that were closed.
pub fn enforce_snapshot(sys: &System, policy: &Policy) -> Vec<AppRef> {
    let mut closed: Vec<AppRef> = Vec::new();
    for process in sys.processes().values() {
        let name = process.name();
        if let Some(app) = blocked_app(policy, name) {
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
