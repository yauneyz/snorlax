// Unix-domain socket NDJSON-RPC server. One line = one message.

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{mpsc, watch, Mutex};

use crate::core::Core;

pub type SharedCore = Arc<Mutex<Core>>;

/// How long to wait for the Core lock before declaring the service wedged. Acquiring it is
/// normally instant — every holder does a short synchronous mutation and drops the guard. If we
/// ever wait this long, some task is parked *while holding* the guard, which blocks every RPC,
/// timer and poll behind it. That failure mode is invisible from the client side: the socket still
/// accepts connections, requests just never get answered.
const CORE_LOCK_STUCK: Duration = Duration::from_secs(5);

/// Acquire the Core lock. Silent on the happy path, loud when it is stuck — the happy path is
/// every request, so this must add no log volume at all when things are healthy.
async fn lock_core<'a>(core: &'a SharedCore, what: &str) -> tokio::sync::MutexGuard<'a, Core> {
    match tokio::time::timeout(CORE_LOCK_STUCK, core.lock()).await {
        Ok(guard) => guard,
        Err(_) => {
            let waited = Instant::now();
            tracing::error!(
                "core lock for {what} not acquired after {}s — the service is wedged: another \
                 task is holding the Core guard, so every RPC, timer and poll is blocked behind \
                 it. Clients connect to the socket fine and then time out on every request.",
                CORE_LOCK_STUCK.as_secs()
            );
            let guard = core.lock().await;
            tracing::error!(
                "core lock for {what} recovered after a further {}ms",
                waited.elapsed().as_millis()
            );
            guard
        }
    }
}

pub async fn run_server(
    core: SharedCore,
    socket_path: String,
    mut shutdown: watch::Receiver<bool>,
) {
    let path = Path::new(&socket_path);
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            tracing::error!(
                "failed to create socket directory {}: {e}",
                parent.display()
            );
            return;
        }
    }
    if path.exists() {
        if let Err(e) = std::fs::remove_file(path) {
            tracing::error!("failed to remove stale socket {}: {e}", path.display());
            return;
        }
    }

    let listener = match UnixListener::bind(path) {
        Ok(l) => l,
        Err(e) => {
            tracing::error!("failed to bind socket {}: {e}", path.display());
            return;
        }
    };
    if let Err(e) = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o666)) {
        tracing::warn!("failed to chmod socket {}: {e}", path.display());
    }

    loop {
        tokio::select! {
            _ = shutdown.changed() => {
                if *shutdown.borrow() { break; }
            }
            res = listener.accept() => {
                match res {
                    Ok((stream, _addr)) => {
                        let core = core.clone();
                        tokio::spawn(handle_connection(core, stream));
                    }
                    Err(e) => tracing::warn!("socket accept error: {e}"),
                }
            }
        }
    }
    let _ = std::fs::remove_file(path);
    tracing::info!("IPC server stopped");
}

async fn handle_connection(core: SharedCore, conn: UnixStream) {
    let (reader, mut writer) = tokio::io::split(conn);
    let (tx, mut rx) = mpsc::channel::<String>(64);

    let writer_task = tokio::spawn(async move {
        while let Some(line) = rx.recv().await {
            if writer.write_all(line.as_bytes()).await.is_err() {
                break;
            }
        }
    });

    let mut events = lock_core(&core, "event subscribe").await.subscribe();
    let event_core = core.clone();
    let ev_tx = tx.clone();
    let event_task = tokio::spawn(async move {
        loop {
            match events.recv().await {
                Ok(value) => {
                    if ev_tx.send(format!("{value}\n")).await.is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                    tracing::warn!("IPC client lagged by {skipped} events");
                    let state = event_core.lock().await.snapshot();
                    let value = json!({ "kind": "event", "event": "stateChanged", "payload": { "state": state } });
                    if ev_tx.send(format!("{value}\n")).await.is_err() {
                        break;
                    }
                    continue;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    let mut lines = BufReader::new(reader).lines();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                if line.trim().is_empty() {
                    continue;
                }
                let response = process_line(&core, &line).await;
                if tx.send(format!("{response}\n")).await.is_err() {
                    break;
                }
            }
            Ok(None) => break,
            Err(e) => {
                tracing::warn!("socket read error: {e}");
                break;
            }
        }
    }

    event_task.abort();
    drop(tx);
    let _ = writer_task.await;
}

async fn process_line(core: &SharedCore, line: &str) -> Value {
    let parsed: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => {
            return json!({ "kind": "response", "id": 0, "ok": false, "code": "BAD_REQUEST", "message": format!("Invalid JSON: {e}") });
        }
    };

    let id = parsed.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
    let method = parsed.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let empty = json!({});
    let params = parsed.get("params").unwrap_or(&empty);

    let mut guard = lock_core(core, method).await;
    let dispatched = Instant::now();
    let outcome = guard.dispatch(method, params);
    drop(guard);
    // dispatch is synchronous and runs with the Core lock held, so a slow one stalls the entire
    // service. Rare by construction, so this costs nothing in a healthy process.
    if dispatched.elapsed() >= Duration::from_secs(1) {
        tracing::error!(
            "{method} held the core lock for {}ms",
            dispatched.elapsed().as_millis()
        );
    }
    match outcome {
        Ok(result) => json!({ "kind": "response", "id": id, "ok": true, "result": result }),
        Err(e) => {
            json!({ "kind": "response", "id": id, "ok": false, "code": e.code, "message": e.message })
        }
    }
}
