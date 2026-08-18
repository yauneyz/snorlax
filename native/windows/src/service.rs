//! Service runtime: builds the Core, spawns the always-on enforcement + monitoring tasks, and
//! runs the IPC server until shutdown. Used by both the SCM service path (main.rs) and the
//! `--console` dev path.

use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tokio::sync::{broadcast, watch, Mutex};

use crate::core::Core;
use crate::enforce::divert;
use crate::enforce::{self, EnforceShared};
use crate::ipc;
use crate::secure_store::SecureStore;
use crate::state::PersistentState;

const PRESENCE_POLL: Duration = Duration::from_secs(3);
/// How often `Core::sweep_expired_judges` runs. Independent of focus/monitoring state — pending
/// judge requests must always eventually get answered, even with focus off or the browser
/// watchdog idle.
const JUDGE_SWEEP_POLL: Duration = Duration::from_secs(2);

async fn wait_for_state_change(events: &mut broadcast::Receiver<Value>) {
    loop {
        match events.recv().await {
            Ok(message) if message.get("event").and_then(Value::as_str) == Some("stateChanged") => {
                return
            }
            Ok(_) => {}
            Err(_) => return,
        }
    }
}

/// Async entry point. Runs until `shutdown` flips to true.
pub async fn serve(pipe_path: String, shutdown: watch::Receiver<bool>) {
    let _ = crate::paths::ensure_data_dir();

    let state = PersistentState::load();
    let store = SecureStore::load();
    let shared = Arc::new(EnforceShared::new(
        state.active_policy(),
        state.focus_active,
    ));

    let core = Arc::new(Mutex::new(Core::new(state, store, shared.clone())));
    core.lock().await.rearm_on_boot();

    // The WinDivert packet engines run on dedicated OS threads (WinDivert recv is blocking). They
    // self-gate on focus_active and are cleaned up on process exit.
    {
        let shared = shared.clone();
        let shutdown = shutdown.clone();
        std::thread::spawn(move || divert::run_engine(shared, shutdown));
    }
    // focusd-style IP-drop manager — focus-gated DROP-flag handle that silently discards outbound
    // packets to the resolver's blocked-IP set (blacklist), or to anything not in the allow set
    // (whitelist/block-all). This is the website blocker.
    {
        let shared = shared.clone();
        let shutdown = shutdown.clone();
        std::thread::spawn(move || divert::run_ip_drop(shared, shutdown));
    }
    // Warm policy-domain resolver ticker — re-resolves the policy's expanded domains on a cadence
    // and swaps the blocked/allowed IP set wholesale against current CDN IPs (focusd's refresh).
    // It runs while focus is off too so the next focus-on starts with an IP bank already populated.
    {
        let shared = shared.clone();
        let shutdown = shutdown.clone();
        std::thread::spawn(move || enforce::resolve::run_resolver(shared, shutdown));
    }

    // One process snapshot feeds both app blocking and the browser dead-man's switch.
    {
        let events = core.lock().await.events.clone();
        tokio::spawn(enforce::browser_watchdog::run_browser_watchdog(
            shared.clone(),
            events,
            shutdown.clone(),
        ));
    }

    {
        let shared = shared.clone();
        let mut sd = shutdown.clone();
        tokio::spawn(async move {
            while sd.changed().await.is_ok() {
                if *sd.borrow() {
                    shared.wake_all();
                    break;
                }
            }
        });
    }

    // USB presence poll.
    {
        let core = core.clone();
        let mut sd = shutdown.clone();
        let mut events = core.lock().await.subscribe();
        tokio::spawn(async move {
            loop {
                if !core.lock().await.has_paired_keys() {
                    tokio::select! {
                        _ = sd.changed() => { if *sd.borrow() { break; } }
                        _ = wait_for_state_change(&mut events) => {}
                    }
                    continue;
                }
                core.lock().await.recompute_presence();
                tokio::select! {
                    _ = sd.changed() => { if *sd.borrow() { break; } }
                    _ = tokio::time::sleep(PRESENCE_POLL) => {}
                    _ = wait_for_state_change(&mut events) => {}
                }
            }
        });
    }

    // Schedule timer.
    {
        let core = core.clone();
        let mut sd = shutdown.clone();
        let mut events = core.lock().await.subscribe();
        tokio::spawn(async move {
            loop {
                while events.try_recv().is_ok() {}
                let delay = {
                    let mut core = core.lock().await;
                    core.schedule_tick();
                    core.next_schedule_delay()
                };
                tokio::select! {
                    _ = sd.changed() => { if *sd.borrow() { break; } }
                    _ = tokio::time::sleep(delay) => {}
                    _ = wait_for_state_change(&mut events) => {}
                }
            }
        });
    }

    // Answers every pending Smart-filtering judge request that Electron never got back to, so the
    // extension is never left hanging. Runs unconditionally — not gated on focus being active.
    {
        let core = core.clone();
        let mut sd = shutdown.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = sd.changed() => { if *sd.borrow() { break; } }
                    _ = tokio::time::sleep(JUDGE_SWEEP_POLL) => {
                        core.lock().await.sweep_expired_judges();
                    }
                }
            }
        });
    }

    tracing::info!("Talysman service running; IPC at {pipe_path}");
    ipc::run_server(core, pipe_path, shutdown).await;

    // NOTE: we intentionally do NOT tear down enforcement on a clean stop — if focus is active,
    // blocking should persist (the SCM restarts us on kill). The killswitch / focus-off path is
    // the sanctioned way to remove enforcement. See enforce::teardown_network.
    let _ = enforce::teardown_network; // keep the symbol referenced for clarity
}

/// Build a multi-thread runtime and run `serve` to completion. Shared by SCM + console paths.
pub fn run_blocking(pipe_path: String, shutdown: watch::Receiver<bool>) {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("failed to build tokio runtime");
    rt.block_on(serve(pipe_path, shutdown));
}
