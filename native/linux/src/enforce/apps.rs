//! Linux app blocking via process termination.

use sysinfo::System;

use crate::model::Policy;
use crate::policy_match::is_app_blocked;

/// Enforce the app policy against an already-refreshed process snapshot. The browser watchdog
/// owns the single process scan shared by both protections.
pub fn enforce_snapshot(sys: &System, policy: &Policy) {
    for process in sys.processes().values() {
        let name = process.name();
        if is_app_blocked(policy, name) {
            if process.kill() {
                tracing::info!("terminated blocked app {name}");
            } else {
                tracing::warn!("failed to terminate {name}");
            }
        }
    }
}
