//! App blocking via process termination (architecture §4.1). v1 polls the process list (~1s)
//! and terminates any process whose image name matches the blocked-app list while focus is
//! active. Pre-execution denial (ETW/WMI process-create events, or a minifilter) is the
//! documented upgrade; polling is simple, robust, and good enough for v1.

use std::sync::Arc;
use std::time::Duration;

use sysinfo::System;

use crate::enforce::EnforceShared;
use crate::policy_match::is_app_blocked;

const POLL: Duration = Duration::from_millis(1000);

pub async fn run_app_blocker(
    shared: Arc<EnforceShared>,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    let mut sys = System::new();
    tracing::info!("app blocker started");
    loop {
        tokio::select! {
            _ = shutdown.changed() => {
                if *shutdown.borrow() { break; }
            }
            _ = tokio::time::sleep(POLL) => {
                if !shared.is_active() {
                    continue;
                }
                let policy = shared.policy_snapshot();
                if policy.apps.is_empty() {
                    continue;
                }
                sys.refresh_processes();
                for process in sys.processes().values() {
                    let name = process.name();
                    if is_app_blocked(&policy, name) {
                        if process.kill() {
                            tracing::info!("terminated blocked app {name}");
                        } else {
                            tracing::warn!("failed to terminate {name}");
                        }
                    }
                }
            }
        }
    }
    tracing::info!("app blocker stopped");
}
