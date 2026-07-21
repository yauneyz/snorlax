//! Service runtime for macOS.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{watch, Mutex};

use crate::core::Core;
use crate::enforce::{self, EnforceShared};
use crate::ipc;
use crate::secure_store::SecureStore;
use crate::state::PersistentState;

const PRESENCE_POLL: Duration = Duration::from_secs(3);
const SCHEDULE_POLL: Duration = Duration::from_secs(30);

pub async fn serve(socket_path: String, shutdown: watch::Receiver<bool>) {
    let _ = crate::paths::ensure_data_dir();

    let state = PersistentState::load();
    let store = SecureStore::load();
    let shared = Arc::new(EnforceShared::new(state.policy.clone(), state.focus_active));

    let core = Arc::new(Mutex::new(Core::new(state, store, shared.clone())));
    core.lock().await.rearm_on_boot();

    // Keep browser native-messaging registration repaired across application upgrades and manual
    // manifest deletion. The LaunchDaemon runs as root; registration is idempotent.
    enforce::extension_policy::install();

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

    tokio::spawn(enforce::apps::run_app_blocker(
        shared.clone(),
        shutdown.clone(),
    ));

    // Browser handshake dead-man's switch (self-gates on focus_active + the handshake setting).
    {
        let events = core.lock().await.events.clone();
        tokio::spawn(enforce::browser_watchdog::run_browser_watchdog(
            shared.clone(),
            events,
            shutdown.clone(),
        ));
    }

    {
        let core = core.clone();
        let mut sd = shutdown.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = sd.changed() => { if *sd.borrow() { break; } }
                    _ = tokio::time::sleep(PRESENCE_POLL) => {
                        core.lock().await.recompute_presence();
                    }
                }
            }
        });
    }

    {
        let core = core.clone();
        let mut sd = shutdown.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = sd.changed() => { if *sd.borrow() { break; } }
                    _ = tokio::time::sleep(SCHEDULE_POLL) => {
                        core.lock().await.schedule_tick();
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
        .enable_all()
        .build()
        .expect("failed to build tokio runtime");
    rt.block_on(serve(socket_path, shutdown));
}
