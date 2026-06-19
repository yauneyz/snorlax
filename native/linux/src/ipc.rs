//! Unix-domain socket NDJSON-RPC server. One line = one message.

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::Arc;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{mpsc, watch, Mutex};

use crate::core::Core;

pub type SharedCore = Arc<Mutex<Core>>;

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

    let mut events = core.lock().await.subscribe();
    let ev_tx = tx.clone();
    let event_task = tokio::spawn(async move {
        while let Ok(value) = events.recv().await {
            let line = format!("{value}\n");
            if ev_tx.send(line).await.is_err() {
                break;
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

    let mut guard = core.lock().await;
    match guard.dispatch(method, params) {
        Ok(result) => json!({ "kind": "response", "id": id, "ok": true, "result": result }),
        Err(e) => {
            json!({ "kind": "response", "id": id, "ok": false, "code": e.code, "message": e.message })
        }
    }
}
