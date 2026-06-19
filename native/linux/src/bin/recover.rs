//! Linux recovery killswitch.

use std::time::Duration;

use anyhow::{bail, Result};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

use focuslock::constants::{socket_path, PIPE_BASE_DEV, PIPE_BASE_PROD};
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

async fn try_socket(base: &str, code: &str) -> Result<bool> {
    let path = socket_path(base);
    let client = match UnixStream::connect(&path).await {
        Ok(c) => c,
        Err(_) => return Ok(false),
    };

    let (reader, mut writer) = tokio::io::split(client);
    let req =
        json!({ "kind": "request", "id": 1, "method": "recover", "params": { "code": code } });
    writer.write_all(format!("{req}\n").as_bytes()).await?;

    let mut lines = BufReader::new(reader).lines();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline {
        let line = tokio::time::timeout(Duration::from_secs(5), lines.next_line()).await;
        let Ok(Ok(Some(line))) = line else { break };
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if value.get("kind").and_then(|v| v.as_str()) == Some("response") {
            if value.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                return Ok(true);
            }
            let msg = value
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("recover rejected");
            bail!("service rejected recovery: {msg}");
        }
    }
    Ok(false)
}

fn offline_recover(code: &str) -> Result<()> {
    let store = SecureStore::load();
    let Some(stored) = store.recovery else {
        bail!("no recovery code is configured on this machine");
    };
    if !pairing::verify_recovery_code(code, &stored) {
        bail!("recovery code did not match");
    }

    enforce::teardown_network();
    enforce::extension_policy::uninstall();

    let _ = std::process::Command::new("systemctl")
        .args(["stop", "focuslock"])
        .output();

    let mut state = focuslock::state::PersistentState::load();
    state.focus_active = false;
    state.focus_source = focuslock::model::FocusSource::Recover;
    let _ = state.save();

    println!("Recovery complete: focus disabled, enforcement removed.");
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let Some(code) = parse_code() else {
        eprintln!("usage: focuslock-recover --code XXXX-XXXX-XXXX");
        std::process::exit(2);
    };

    for base in [PIPE_BASE_PROD, PIPE_BASE_DEV] {
        match try_socket(base, &code).await {
            Ok(true) => {
                println!("Recovery accepted by the running service: focus disabled.");
                return Ok(());
            }
            Ok(false) => {}
            Err(e) => {
                eprintln!("error: {e:#}");
                std::process::exit(1);
            }
        }
    }

    if let Err(e) = offline_recover(&code) {
        eprintln!("error: {e:#}");
        std::process::exit(1);
    }
    Ok(())
}
