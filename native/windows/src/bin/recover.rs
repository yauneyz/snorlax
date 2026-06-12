//! focuslock-recover.exe — the backdoor killswitch (architecture §9, and the user's explicit
//! safety-net requirement). Run as administrator:
//!
//!   focuslock-recover.exe --code XXXX-XXXX-XXXX
//!
//! Strategy:
//!   1. Try the live service over the named pipe → privileged `recover` RPC, which verifies the
//!      code and force-disables focus (bypassing the USB + locked gates).
//!   2. If the service is unreachable/wedged, verify the code locally against the secure store,
//!      then directly tear down enforcement (restore DNS, remove firewall rules) and stop the
//!      service via the SCM.
//!
//! Either way you can always recover without the USB key. The absolute last resort (Safe Mode
//! + `sc delete FocusLockSvc`) is documented in build-guide.md.

use std::time::Duration;

use anyhow::{bail, Result};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::ClientOptions;

use focuslock::constants::{pipe_path, PIPE_BASE_DEV, PIPE_BASE_PROD};
use focuslock::enforce;
use focuslock::pairing;
use focuslock::secure_store::SecureStore;

fn parse_code() -> Option<String> {
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        if a == "--code" {
            return args.next();
        }
        if let Some(rest) = a.strip_prefix("--code=") {
            return Some(rest.to_string());
        }
    }
    None
}

/// Try the live service over a pipe. Returns Ok(true) if it accepted the recovery.
async fn try_pipe(base: &str, code: &str) -> Result<bool> {
    let path = pipe_path(base);
    let client = match ClientOptions::new().open(&path) {
        Ok(c) => c,
        Err(_) => return Ok(false), // service not listening on this pipe
    };

    let (reader, mut writer) = tokio::io::split(client);
    let req = json!({ "kind": "request", "id": 1, "method": "recover", "params": { "code": code } });
    writer.write_all(format!("{req}\n").as_bytes()).await?;

    let mut lines = BufReader::new(reader).lines();
    // Read until our response arrives (skip any pushed events).
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline {
        let line = tokio::time::timeout(Duration::from_secs(5), lines.next_line()).await;
        let Ok(Ok(Some(line))) = line else { break };
        let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
        if value.get("kind").and_then(|v| v.as_str()) == Some("response") {
            if value.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                return Ok(true);
            }
            let msg = value.get("message").and_then(|v| v.as_str()).unwrap_or("recover rejected");
            bail!("service rejected recovery: {msg}");
        }
    }
    Ok(false)
}

/// Offline fallback: verify locally, tear down enforcement, stop the service.
fn offline_recover(code: &str) -> Result<()> {
    let store = SecureStore::load();
    let Some(stored) = store.recovery else {
        bail!("no recovery code is configured on this machine");
    };
    if !pairing::verify_recovery_code(code, &stored) {
        bail!("recovery code did not match");
    }

    eprintln!("Service unreachable — performing offline recovery.");
    enforce::teardown_network(); // restore adapter DNS + remove firewall rules

    // Best-effort: stop the service so it doesn't immediately re-arm.
    stop_service_best_effort();

    // Mark focus inactive in persisted state so a restart doesn't re-arm.
    let mut state = focuslock::state::PersistentState::load();
    state.focus_active = false;
    state.focus_source = focuslock::model::FocusSource::Recover;
    let _ = state.save();

    println!("Recovery complete: focus disabled, enforcement removed.");
    Ok(())
}

fn stop_service_best_effort() {
    use windows_service::service::ServiceAccess;
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
    if let Ok(manager) = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT) {
        if let Ok(service) =
            manager.open_service(focuslock::constants::SERVICE_NAME, ServiceAccess::STOP)
        {
            let _ = service.stop();
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let Some(code) = parse_code() else {
        eprintln!("usage: focuslock-recover.exe --code XXXX-XXXX-XXXX");
        std::process::exit(2);
    };

    // 1) Try the live service (prod pipe, then dev pipe).
    for base in [PIPE_BASE_PROD, PIPE_BASE_DEV] {
        match try_pipe(base, &code).await {
            Ok(true) => {
                println!("Recovery accepted by the running service: focus disabled.");
                return Ok(());
            }
            Ok(false) => {}
            Err(e) => {
                // The service answered but rejected the code — no point trying offline.
                eprintln!("error: {e:#}");
                std::process::exit(1);
            }
        }
    }

    // 2) Offline fallback.
    if let Err(e) = offline_recover(&code) {
        eprintln!("error: {e:#}");
        std::process::exit(1);
    }
    Ok(())
}
