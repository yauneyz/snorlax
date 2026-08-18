//! Service runtime for macOS.

use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tokio::sync::{broadcast, watch, Mutex};

use crate::core::Core;
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

pub async fn serve(socket_path: String, shutdown: watch::Receiver<bool>) {
    let _ = crate::paths::ensure_data_dir();

    let state = PersistentState::load();
    let store = SecureStore::load();
    let shared = Arc::new(EnforceShared::new(
        state.active_policy(),
        state.focus_active,
    ));

    let core = Arc::new(Mutex::new(Core::new(state, store, shared.clone())));
    core.lock().await.rearm_on_boot();

    {
        let shared = shared.clone();
        let shutdown = shutdown.clone();
        std::thread::spawn(move || enforce::pf::run_manager(shared, shutdown));
    }
    {
        let shared = shared.clone();
        let shutdown = shutdown.clone();
        std::thread::spawn(move || enforce::hosts::run_manager(shared, shutdown));
    }
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

    tracing::info!("Talysman macOS service running; IPC at {socket_path}");
    ipc::run_server(core, socket_path, shutdown).await;
}

pub fn run_blocking(socket_path: String, shutdown: watch::Receiver<bool>) {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("failed to build tokio runtime");
    rt.block_on(serve(socket_path, shutdown));
}
