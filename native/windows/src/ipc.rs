//! Named-pipe NDJSON-RPC server (architecture §6). One line = one message. Each connection
//! gets a writer task fed by an mpsc queue, so RPC responses and pushed events interleave
//! safely on the same pipe.

use std::sync::Arc;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::ServerOptions;
use tokio::sync::{mpsc, watch, Mutex};

use crate::core::Core;

pub type SharedCore = Arc<Mutex<Core>>;

/// Accept connections on `pipe_path` until `shutdown` flips to true.
pub async fn run_server(core: SharedCore, pipe_path: String, mut shutdown: watch::Receiver<bool>) {
    let mut first = true;
    loop {
        let server = match ServerOptions::new().first_pipe_instance(first).create(&pipe_path) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!("failed to create pipe {pipe_path}: {e}");
                return;
            }
        };
        first = false;

        tokio::select! {
            _ = shutdown.changed() => {
                if *shutdown.borrow() { break; }
            }
            res = server.connect() => {
                if let Err(e) = res {
                    tracing::warn!("pipe connect error: {e}");
                    continue;
                }
                let core = core.clone();
                tokio::spawn(handle_connection(core, server));
            }
        }
    }
    tracing::info!("IPC server stopped");
}

async fn handle_connection(core: SharedCore, conn: tokio::net::windows::named_pipe::NamedPipeServer) {
    let (reader, mut writer) = tokio::io::split(conn);
    let (tx, mut rx) = mpsc::channel::<String>(64);

    // Writer task: drains the queue to the pipe.
    let writer_task = tokio::spawn(async move {
        while let Some(line) = rx.recv().await {
            if writer.write_all(line.as_bytes()).await.is_err() {
                break;
            }
        }
    });

    // Event task: forward pushed service events to this client.
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

    // Reader loop: one request per line.
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
            Ok(None) => break, // client disconnected
            Err(e) => {
                tracing::warn!("pipe read error: {e}");
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
        Err(e) => json!({ "kind": "response", "id": id, "ok": false, "code": e.code, "message": e.message }),
    }
}
