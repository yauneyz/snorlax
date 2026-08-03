//! App blocking via process termination (architecture §4.1). v1 polls the process list (~1s)
//! and terminates any process whose image name matches the blocked-app list while focus is
//! active. Pre-execution denial (ETW/WMI process-create events, or a minifilter) is the
//! documented upgrade; polling is simple, robust, and good enough for v1.

use sysinfo::System;

use crate::model::Policy;
use crate::policy_match::is_app_blocked;

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
