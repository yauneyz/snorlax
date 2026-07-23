//! Browser handshake dead-man's switch (macOS). Mirror of the Linux/Windows watchdogs: it polls
//! the process list (~1s), feeds the running *root* browser processes plus the latest extension
//! heartbeats into the shared [`talysman_common::watchdog`] state machine, and performs the
//! actions it returns. The OS-specific parts are classification — the CFBundleIdentifier of the
//! enclosing .app bundle instead of a process name (helper bundles like "com.google.Chrome.helper"
//! collapse into their browser root via the shared prefix) — and closing: `SIGTERM` for a graceful
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

use talysman_common::browsers::by_mac_bundle;
use talysman_common::watchdog::{heartbeats_by_root, roots, Action, ScannedProc, Watchdog};

use crate::bundle;
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
                        let bundle_id = p.exe().and_then(bundle::bundle_id_for_exe)?;
                        by_mac_bundle(&bundle_id).map(|def| ScannedProc {
                            pid: p.pid().as_u32(),
                            parent: p.parent().map(|pp| pp.as_u32()),
                            class: def.class,
                            key: def.key.to_string(),
                        })
                    })
                    .collect();

                let roots = roots(&scan);
                let live: HashSet<u32> = scan.iter().map(|process| process.pid).collect();
                shared.retain_heartbeats(&live);
                let raw_heartbeats = shared.heartbeats_snapshot();
                let heartbeats = heartbeats_by_root(&scan, &raw_heartbeats);

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
                        Action::Kill { pid, browser, first_attempt } => {
                            tracing::warn!("browser watchdog: killing {browser} (pid {pid})");
                            if first_attempt {
                                let _ = events.send(json!({
                                    "kind": "event",
                                    "event": "browserWatchdogKilled",
                                    "payload": { "browser": browser, "pid": pid },
                                }));
                            }
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
