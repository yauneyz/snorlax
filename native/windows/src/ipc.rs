//! Named-pipe NDJSON-RPC server (architecture §6). One line = one message. Each connection
//! gets a writer task fed by an mpsc queue, so RPC responses and pushed events interleave
//! safely on the same pipe.

use std::ffi::c_void;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::ServerOptions;
use tokio::sync::{mpsc, watch, Mutex};
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL};
use windows::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows::Win32::Security::{
    GetTokenInformation, TokenUser, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY,
    TOKEN_USER,
};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

use crate::core::Core;

pub type SharedCore = Arc<Mutex<Core>>;

/// String SID of the account this process runs as (SYSTEM when installed as a service, the
/// developer's user in `--console` mode).
fn process_user_sid() -> windows::core::Result<String> {
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token)?;
        let mut len = 0u32;
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut len);
        // u64 backing so the TOKEN_USER struct is pointer-aligned.
        let mut buf = vec![0u64; (len as usize).div_ceil(8)];
        let res = GetTokenInformation(
            token,
            TokenUser,
            Some(buf.as_mut_ptr() as *mut c_void),
            len,
            &mut len,
        );
        let _ = CloseHandle(token);
        res?;
        let user = &*(buf.as_ptr() as *const TOKEN_USER);
        let mut sid_str = PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut sid_str)?;
        let sid = sid_str.to_string()?;
        let _ = LocalFree(HLOCAL(sid_str.0 as *mut c_void));
        Ok(sid)
    }
}

/// Owns the converted security descriptor for the lifetime of the server loop.
struct PipeSecurity {
    descriptor: PSECURITY_DESCRIPTOR,
}

// The descriptor is plain heap memory from ConvertStringSecurityDescriptor…; nothing
// thread-affine about it.
unsafe impl Send for PipeSecurity {}

impl PipeSecurity {
    fn new() -> windows::core::Result<Self> {
        // DACL for the pipe. The service runs as LocalSystem, whose default DACL admits only
        // SYSTEM and Administrators — the un-elevated desktop app would get ACCESS_DENIED on
        // connect. Grant SYSTEM/Admins/our own account full control and the interactive user
        // read/write (0x12019b = FILE_GENERIC_READ | FILE_GENERIC_WRITE minus
        // FILE_CREATE_PIPE_INSTANCE, so a non-admin process cannot squat additional instances
        // of our pipe name). The explicit own-account ACE keeps `--console` dev mode (running
        // as a plain user) able to create follow-up pipe instances.
        let own_sid = process_user_sid()?;
        let sddl_string =
            format!("D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;{own_sid})(A;;0x12019b;;;IU)");
        let sddl: Vec<u16> = sddl_string
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut descriptor = PSECURITY_DESCRIPTOR::default();
        unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                PCWSTR(sddl.as_ptr()),
                SDDL_REVISION_1,
                &mut descriptor,
                None,
            )?;
        }
        Ok(Self { descriptor })
    }

    fn attributes(&self) -> SECURITY_ATTRIBUTES {
        SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: self.descriptor.0,
            bInheritHandle: false.into(),
        }
    }
}

impl Drop for PipeSecurity {
    fn drop(&mut self) {
        if !self.descriptor.0.is_null() {
            unsafe {
                let _ = LocalFree(HLOCAL(self.descriptor.0));
            }
        }
    }
}

/// How long to wait for the Core lock before declaring the service wedged. Acquiring it is
/// normally instant — every holder does a short synchronous mutation and drops the guard. If we
/// ever wait this long, some task is parked *while holding* the guard, which blocks every RPC,
/// timer and poll behind it. That failure mode is invisible from the client side: the pipe still
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
                 it. Clients connect to the pipe fine and then time out on every request.",
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

/// Accept connections on `pipe_path` until `shutdown` flips to true.
pub async fn run_server(core: SharedCore, pipe_path: String, mut shutdown: watch::Receiver<bool>) {
    let security = match PipeSecurity::new() {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("failed to build pipe security descriptor: {e}");
            return;
        }
    };
    let mut first = true;
    loop {
        let mut attrs = security.attributes();
        let server = match unsafe {
            ServerOptions::new()
                .first_pipe_instance(first)
                .create_with_security_attributes_raw(
                    &pipe_path,
                    &mut attrs as *mut _ as *mut c_void,
                )
        } {
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

async fn handle_connection(
    core: SharedCore,
    conn: tokio::net::windows::named_pipe::NamedPipeServer,
) {
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
