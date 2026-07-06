//! Browser handshake dead-man's switch (Linux). Mirror of the Windows watchdog: it polls the
//! process list (~1s), feeds the running *root* browser processes plus the latest extension
//! heartbeats into the shared [`talysman_common::watchdog`] state machine, and performs the
//! actions it returns. The only OS-specific part is how we close/kill: `SIGTERM` for a graceful
//! close, `SIGKILL` to force it.
//!
//! Only runs while focus is active AND the handshake setting is on (see `EnforceShared`); otherwise
//! it resets the state machine so a later enable starts clean.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use sysinfo::{Pid, Signal, System};
use tokio::sync::broadcast;

use talysman_common::browsers::by_linux_process_identity;
use talysman_common::watchdog::{roots, Action, ScannedProc, Watchdog};

use crate::enforce::EnforceShared;

const POLL: Duration = Duration::from_millis(1000);

pub async fn run_browser_watchdog(
    shared: Arc<EnforceShared>,
    events: broadcast::Sender<Value>,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    let mut sys = System::new();
    let mut wd = Watchdog::default();
    tracing::info!("browser watchdog started");
    loop {
        tokio::select! {
            _ = shutdown.changed() => {
                if *shutdown.borrow() { break; }
            }
            _ = tokio::time::sleep(POLL) => {
                if !shared.is_active() || !shared.handshake_enabled() {
                    wd.reset();
                    continue;
                }
                sys.refresh_processes();

                let scan: Vec<ScannedProc> = sys
                    .processes()
                    .values()
                    .filter_map(|p| {
                        let argv0 = p.cmd().first().map(|arg| arg.as_str());
                        by_linux_process_identity(p.name(), argv0).map(|def| ScannedProc {
                            pid: p.pid().as_u32(),
                            parent: p.parent().map(|pp| pp.as_u32()),
                            class: def.class,
                            key: def.key.to_string(),
                        })
                    })
                    .collect();

                let roots = roots(&scan);
                let live: HashSet<u32> = roots.iter().map(|r| r.pid).collect();
                shared.retain_heartbeats(&live);
                let heartbeats = shared.heartbeats_snapshot();

                for action in wd.tick(Instant::now(), &roots, &heartbeats) {
                    match action {
                        Action::Warn { pid, browser } => {
                            tracing::warn!("browser watchdog: warning {browser} (pid {pid})");
                            let _ = events.send(json!({
                                "kind": "event",
                                "event": "browserWatchdogWarning",
                                "payload": { "browser": browser, "pid": pid },
                            }));
                        }
                        Action::Close { pid, browser } => {
                            tracing::warn!("browser watchdog: closing {browser} (pid {pid})");
                            signal(&sys, pid, Signal::Term);
                        }
                        Action::Kill { pid, browser } => {
                            tracing::warn!("browser watchdog: killing {browser} (pid {pid})");
                            signal(&sys, pid, Signal::Kill);
                        }
                    }
                }
            }
        }
    }
    tracing::info!("browser watchdog stopped");
}

/// Send `sig` to `pid` if it is still in the last process scan.
fn signal(sys: &System, pid: u32, sig: Signal) {
    if let Some(proc) = sys.process(Pid::from_u32(pid)) {
        if proc.kill_with(sig).is_none() {
            tracing::warn!("browser watchdog: signal {sig:?} unsupported on this platform");
        }
    }
}
