//! Browser handshake dead-man's switch (Windows). Polls the process list (~1s, like `apps.rs`) and
//! feeds the running *root* browser processes plus the latest extension heartbeats into the shared
//! [`focuslock_common::watchdog`] state machine. The machine decides; this module performs the
//! OS-specific actions it returns: warn the user, post `WM_CLOSE` to the browser's windows, or
//! `TerminateProcess`.
//!
//! Only runs while focus is active AND the handshake setting is on (see `EnforceShared`); otherwise
//! it resets the state machine so a later enable starts clean.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use sysinfo::System;
use tokio::sync::broadcast;

use focuslock_common::browsers::by_windows_image;
use focuslock_common::watchdog::{roots, Action, ScannedProc, Watchdog};

use crate::enforce::EnforceShared;

use windows::Win32::Foundation::{CloseHandle, BOOL, HWND, LPARAM, TRUE, WPARAM};
use windows::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowThreadProcessId, PostMessageW, WM_CLOSE,
};

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

                // Build the browser-process scan (pid, parent, classification).
                let scan: Vec<ScannedProc> = sys
                    .processes()
                    .values()
                    .filter_map(|p| {
                        by_windows_image(p.name()).map(|def| ScannedProc {
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
                            close_windows(pid);
                        }
                        Action::Kill { pid, browser } => {
                            tracing::warn!("browser watchdog: killing {browser} (pid {pid})");
                            terminate(pid);
                        }
                    }
                }
            }
        }
    }
    tracing::info!("browser watchdog stopped");
}

/// LPARAM payload for the EnumWindows callback.
struct CloseTarget {
    pid: u32,
}

unsafe extern "system" fn enum_close(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let target = &*(lparam.0 as *const CloseTarget);
    let mut win_pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut win_pid));
    if win_pid == target.pid {
        // Ask the window to close; ignore failures (window may already be gone).
        let _ = PostMessageW(hwnd, WM_CLOSE, WPARAM(0), LPARAM(0));
    }
    TRUE // keep enumerating
}

/// Post `WM_CLOSE` to every top-level window owned by `pid` (graceful close).
fn close_windows(pid: u32) {
    let target = CloseTarget { pid };
    unsafe {
        let _ = EnumWindows(Some(enum_close), LPARAM(&target as *const _ as isize));
    }
}

/// Force-terminate the process.
fn terminate(pid: u32) {
    unsafe {
        match OpenProcess(PROCESS_TERMINATE, false.into(), pid) {
            Ok(handle) => {
                if TerminateProcess(handle, 1).is_err() {
                    tracing::warn!("browser watchdog: TerminateProcess failed for pid {pid}");
                }
                let _ = CloseHandle(handle);
            }
            Err(e) => {
                tracing::warn!("browser watchdog: OpenProcess failed for pid {pid}: {e}");
            }
        }
    }
}
