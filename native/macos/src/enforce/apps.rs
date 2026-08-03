//! macOS app blocking via process termination.

use sysinfo::System;

use crate::bundle;
use crate::model::Policy;
use crate::policy_match::is_app_blocked;

pub fn enforce_snapshot(sys: &System, policy: &Policy) {
    for process in sys.processes().values() {
        let name = process.name();
        let bundle_id = process.exe().and_then(bundle::bundle_id_for_exe);
        if is_app_blocked(policy, name, bundle_id.as_deref()) {
            if process.kill() {
                tracing::info!("terminated blocked app {name}");
            } else {
                tracing::warn!("failed to terminate {name}");
            }
        }
    }
}
