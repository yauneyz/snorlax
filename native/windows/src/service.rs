//! Service runtime: builds the Core, spawns the always-on enforcement + monitoring tasks, and
//! runs the IPC server until shutdown. Used by both the SCM service path (main.rs) and the
//! `--console` dev path.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{watch, Mutex};

use crate::core::Core;
use crate::enforce::observations::ObservationStore;
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
    // Persisted antibody store: learned host→IP observations that pre-arm the suspect/clean set
    // at focus-on (survives restarts). Shared with the SNI recorder + resolver via EnforceShared.
    let observations = Arc::new(ObservationStore::load());
    let shared = Arc::new(EnforceShared::new(
        state.policy.clone(),
        state.focus_active,
        observations,
    ));

    let core = Arc::new(Mutex::new(Core::new(state, store, shared.clone())));
    core.lock().await.rearm_on_boot();

    // Persistently force-install the browser extension + register its native-messaging host. This
    // is install-time, not focus-toggled: the extension self-gates on the live state the host
    // pushes (no rules while focus is off), so it's safe to leave installed. Idempotent.
    enforce::extension_policy::install();

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
    // Pre-armed suspect-IP drop manager — focus-gated DROP-flag handle that silently discards
    // 443 application-data to in-scope destinations (blacklist: tainted set; whitelist: not the
    // clean set; block-all: all). This is the IP-first enforcement point (see blocking-upgrade.md).
    {
        let shared = shared.clone();
        let shutdown = shutdown.clone();
        std::thread::spawn(move || divert::run_taint_drop(shared, shutdown));
    }
    // VPN-transparent connect-block engine — SOCKET-layer handle that blocks connect() to in-scope
    // destinations at connection setup, before the OS routes the packet into a VPN tunnel, so the
    // IP-first model holds even behind a full-tunnel VPN (the gap the NETWORK-layer engines, which
    // see only encrypted blobs to the VPN server, can't close).
    {
        let shared = shared.clone();
        let shutdown = shutdown.clone();
        std::thread::spawn(move || divert::run_socket_engine(shared, shutdown));
    }
    // Active blocked-domain resolver ticker — re-resolves the policy's domains on a cadence to
    // pre-arm the suspect/clean set against current CDN IPs and grow the antibody store.
    {
        let shared = shared.clone();
        let shutdown = shutdown.clone();
        std::thread::spawn(move || enforce::resolve::run_resolver(shared, shutdown));
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

    // Persist any pending learned observations before we exit.
    shared.observations().flush();

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
