//! App blocking via process termination (architecture §4.1). v1 polls the process list (~1s)
//! and terminates any process whose image name matches the blocked-app list while focus is
//! active. Pre-execution denial (ETW/WMI process-create events, or a minifilter) is the
//! documented upgrade; polling is simple, robust, and good enough for v1.

use sysinfo::System;

use crate::model::{AppRef, Policy};
use crate::policy_match::blocked_app;

/// Kill every running blocked app; returns the blocklist entries that were closed.
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
