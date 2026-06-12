//! Service runtime: builds the Core, spawns the always-on enforcement + monitoring tasks, and
//! runs the IPC server until shutdown. Used by both the SCM service path (main.rs) and the
//! `--console` dev path.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{mpsc, watch, Mutex};

use crate::core::Core;
use crate::enforce::{self, EnforceShared};
use crate::ipc;
use crate::secure_store::SecureStore;
use crate::state::PersistentState;
use crate::{enforce::apps, enforce::divert};

const PRESENCE_POLL: Duration = Duration::from_secs(3);
const SCHEDULE_POLL: Duration = Duration::from_secs(30);

/// Async entry point. Runs until `shutdown` flips to true.
pub async fn serve(pipe_path: String, shutdown: watch::Receiver<bool>) {
    let _ = crate::paths::ensure_data_dir();

    let state = PersistentState::load();
    let store = SecureStore::load();
    let (reset_tx, reset_rx) = mpsc::unbounded_channel::<enforce::ResetKind>();
    let shared = Arc::new(EnforceShared::new(
        state.policy.clone(),
        state.focus_active,
        reset_tx,
    ));

    let core = Arc::new(Mutex::new(Core::new(state, store, shared.clone())));
    core.lock().await.rearm_on_boot();

    // The WinDivert packet engines and reset worker run on dedicated OS threads (WinDivert recv
    // is blocking). They self-gate on focus_active and are cleaned up on process exit.
    {
        let shared = shared.clone();
        let shutdown = shutdown.clone();
        std::thread::spawn(move || divert::run_engine(shared, shutdown));
    }
    // 443 SNI inspection engine — always-on (record-only while unfocused, blocking while
    // focused; the handle's filter tracks focus transitions).
    {
        let shared = shared.clone();
        let shutdown = shutdown.clone();
        std::thread::spawn(move || divert::run_sni_engine(shared, shutdown));
    }
    // Tainted-destination drop manager — focus-gated DROP-flag handle that kills all 443 egress
    // to destinations observed serving blocked SNIs (see blocking-upgrade.md).
    {
        let shared = shared.clone();
        let shutdown = shutdown.clone();
        std::thread::spawn(move || divert::run_taint_drop(shared, shutdown));
    }
    {
        let shared = shared.clone();
        std::thread::spawn(move || divert::run_reset_worker(shared, reset_rx));
    }

    // Always-on app blocker (self-gates on focus_active).
    tokio::spawn(apps::run_app_blocker(shared.clone(), shutdown.clone()));

    // USB presence poll.
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

    // Schedule timer.
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

    tracing::info!("FocusLock service running; IPC at {pipe_path}");
    ipc::run_server(core, pipe_path, shutdown).await;

    // NOTE: we intentionally do NOT tear down enforcement on a clean stop — if focus is active,
    // blocking should persist (the SCM restarts us on kill). The killswitch / focus-off path is
    // the sanctioned way to remove enforcement. See enforce::teardown_network.
    let _ = enforce::teardown_network; // keep the symbol referenced for clarity
}

/// Build a multi-thread runtime and run `serve` to completion. Shared by SCM + console paths.
pub fn run_blocking(pipe_path: String, shutdown: watch::Receiver<bool>) {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("failed to build tokio runtime");
    rt.block_on(serve(pipe_path, shutdown));
}
