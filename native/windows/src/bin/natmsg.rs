//! talysman-natmsg.exe — the browser native-messaging host that bridges the Talysman extension
//! to the privileged service.
//!
//! Browsers can't talk to our named pipe, so the extension speaks Chrome/Firefox **native
//! messaging** (4-byte little-endian length prefix + UTF-8 JSON on stdio) to this host, which the
//! browser spawns. Two directions:
//!   - service → extension: the minimal blocking state the extension needs:
//!       { "type": "state", "active": bool, "mode": "blacklist"|"whitelist"|"block-all",
//!         "domains": [..] }
//!   - extension → service: liveness heartbeats (`{type:"heartbeat", ...}`) are relayed to the
//!     service as `extHeartbeat` RPCs, tagged with the browser's **root PID** — resolved from this
//!     host's startup ancestry — so the watchdog can correlate and, if needed, target that process.
//!
//! It tracks state from the initial `getState` plus the service's pushed `focusChanged` /
//! `policyChanged` events. When the extension's port closes, the browser closes our stdin → we exit.
//! When the pipe drops we reconnect; the extension keeps its last ruleset meanwhile (so killing this
//! bridge can't unblock a locked session).

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::AsyncBufReadExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::ClientOptions;
use tokio::sync::{mpsc, Mutex};

use talysman::constants::{pipe_path, PIPE_BASE_DEV, PIPE_BASE_PROD};
use talysman_common::browsers::by_windows_image;

use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::GetCurrentProcessId;

/// Max native-messaging frame we'll accept from the browser (the platform cap is 1 MiB).
const MAX_FRAME: u32 = 1024 * 1024;

/// RPC id for the initial `getState` (its response carries the authoritative snapshot). Heartbeat
/// relays use ids from `NEXT_ID` so their responses are ignored by the state parser.
const GET_STATE_ID: i64 = 1;
static NEXT_ID: AtomicU64 = AtomicU64::new(2);

/// Minimal blocking state derived from the service's `ServiceState` / events.
#[derive(Clone, Default, PartialEq)]
struct Blocking {
    active: bool,
    mode: String,
    domains: Vec<String>,
}

impl Blocking {
    fn to_msg(&self) -> Value {
        json!({
            "type": "state",
            "active": self.active,
            "mode": if self.mode.is_empty() { "blacklist" } else { self.mode.as_str() },
            "domains": self.domains,
        })
    }
}

fn parse_policy(policy: &Value, b: &mut Blocking) {
    if let Some(mode) = policy.get("mode").and_then(|v| v.as_str()) {
        b.mode = mode.to_string();
    }
    if let Some(domains) = policy.get("domains").and_then(|v| v.as_array()) {
        b.domains = domains
            .iter()
            .filter_map(|d| d.as_str().map(str::to_string))
            .collect();
    }
}

#[derive(Debug)]
struct ProcessEntry {
    parent: u32,
    image: String,
}

fn browser_root_from_snapshot(me: u32, processes: &HashMap<u32, ProcessEntry>) -> u32 {
    let Some(immediate_parent) = processes.get(&me).map(|entry| entry.parent) else {
        return 0;
    };
    let mut current_pid = immediate_parent;
    let mut browser_pid = immediate_parent;
    let mut browser_key: Option<String> = None;
    let mut seen = HashSet::new();

    while current_pid != 0 && seen.insert(current_pid) {
        let Some(entry) = processes.get(&current_pid) else {
            break;
        };
        if let Some(browser) = by_windows_image(&entry.image) {
            match browser_key.as_deref() {
                None => {
                    browser_key = Some(browser.key.to_string());
                    browser_pid = current_pid;
                }
                Some(key) if key == browser.key => browser_pid = current_pid,
                Some(_) => break,
            }
        }
        current_pid = entry.parent;
    }

    browser_pid
}

/// Resolve the browser's root PID while Chrome's short-lived native-host launcher and its ancestry
/// are still present in the process table.
fn browser_root_pid() -> u32 {
    unsafe {
        let me = GetCurrentProcessId();
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return 0;
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut processes = HashMap::new();
        if Process32FirstW(snap, &mut entry).is_ok() {
            loop {
                let image_len = entry
                    .szExeFile
                    .iter()
                    .position(|character| *character == 0)
                    .unwrap_or(entry.szExeFile.len());
                processes.insert(
                    entry.th32ProcessID,
                    ProcessEntry {
                        parent: entry.th32ParentProcessID,
                        image: String::from_utf16_lossy(&entry.szExeFile[..image_len]),
                    },
                );
                if Process32NextW(snap, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
        browser_root_from_snapshot(me, &processes)
    }
}

/// Build an `extHeartbeat` request from the extension's heartbeat frame, tagged with `browser_pid`.
fn heartbeat_request(frame: &Value, browser_pid: u32) -> Value {
    json!({
        "kind": "request",
        "id": NEXT_ID.fetch_add(1, Ordering::Relaxed),
        "method": "extHeartbeat",
        "params": {
            "browserPid": browser_pid,
            "browser": frame.get("browser").and_then(|v| v.as_str()).unwrap_or(""),
            "workerSessionId": frame.get("workerSessionId").cloned().unwrap_or(Value::Null),
            "sequence": frame.get("sequence").cloned().unwrap_or(Value::Null),
            "sentAt": frame.get("sentAt").cloned().unwrap_or(Value::Null),
            "extensionVersion": frame.get("extensionVersion").cloned().unwrap_or(Value::Null),
            "lockedActive": frame.get("lockedActive").cloned().unwrap_or(Value::Null),
            "health": frame.get("health").cloned().unwrap_or_else(|| json!({})),
        }
    })
}

fn heartbeat_ack(response: &Value) -> Option<Value> {
    let heartbeat = response.pointer("/result/heartbeat")?;
    Some(json!({
        "type": "heartbeatAck",
        "sequence": heartbeat.get("sequence").cloned().unwrap_or(Value::Null),
        "browserPid": heartbeat.get("browserPid").cloned().unwrap_or(Value::Null),
        "healthy": heartbeat.get("healthy").cloned().unwrap_or(Value::Null),
    }))
}

#[tokio::main]
async fn main() {
    let browser_pid = browser_root_pid();

    // Single writer task owns stdout so pipe-loop pushes and stdin-triggered resends never interleave.
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Value>();
    tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(msg) = out_rx.recv().await {
            if write_frame(&mut stdout, &msg).await.is_err() {
                break; // browser closed the port
            }
        }
    });

    let last: Arc<Mutex<Option<Blocking>>> = Arc::new(Mutex::new(None));

    // Requests to relay to the service (extension heartbeats). Persists across pipe reconnects.
    let (to_service_tx, mut to_service_rx) = mpsc::unbounded_channel::<Value>();

    // stdin reader: heartbeats relay to the service; any other frame (the extension's `hello`)
    // requests a state resend.
    {
        let out_tx = out_tx.clone();
        let last = last.clone();
        tokio::spawn(async move {
            let mut stdin = tokio::io::stdin();
            loop {
                match read_frame(&mut stdin).await {
                    Ok(Some(msg)) => match msg.get("type").and_then(|t| t.as_str()) {
                        Some("heartbeat") => {
                            let _ = to_service_tx.send(heartbeat_request(&msg, browser_pid));
                        }
                        _ => {
                            if let Some(b) = last.lock().await.clone() {
                                let _ = out_tx.send(b.to_msg()); // `hello` → resend latest state
                            }
                        }
                    },
                    // EOF or error: the port is gone. Native-messaging hosts exit with their port.
                    _ => std::process::exit(0),
                }
            }
        });
    }

    // Pipe loop: keep the service connection up and translate state/events into extension pushes.
    loop {
        if let Err(_e) = pump_pipe(&out_tx, &last, &mut to_service_rx).await {
            // Connection failed or dropped; back off and retry. The extension keeps its last rules.
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    // Never returns; the process exits when the extension closes our stdin (see the stdin task).
}

#[cfg(test)]
mod tests {
    use super::*;

    fn process(parent: u32, image: &str) -> ProcessEntry {
        ProcessEntry {
            parent,
            image: image.to_string(),
        }
    }

    #[test]
    fn resolves_short_lived_chrome_launcher_to_browser_root() {
        let processes = HashMap::from([
            (900, process(14152, "talysman-natmsg.exe")),
            (14152, process(37132, "chrome.exe")),
            (37132, process(1200, "chrome.exe")),
            (1200, process(0, "explorer.exe")),
        ]);

        assert_eq!(browser_root_from_snapshot(900, &processes), 37132);
    }
}

/// Connect to the service (prod pipe, then dev) and stream state until the pipe drops.
async fn pump_pipe(
    out_tx: &mpsc::UnboundedSender<Value>,
    last: &Arc<Mutex<Option<Blocking>>>,
    to_service_rx: &mut mpsc::UnboundedReceiver<Value>,
) -> std::io::Result<()> {
    let client = ClientOptions::new()
        .open(pipe_path(PIPE_BASE_PROD))
        .or_else(|_| ClientOptions::new().open(pipe_path(PIPE_BASE_DEV)))?;

    let (reader, mut pipe_w) = tokio::io::split(client);
    // Ask for the full snapshot up front.
    pipe_w
        .write_all(b"{\"kind\":\"request\",\"id\":1,\"method\":\"getState\",\"params\":null}\n")
        .await?;

    let mut b = Blocking::default();
    let mut lines = BufReader::new(reader).lines();
    loop {
        tokio::select! {
            // Outbound: relay an extension heartbeat to the service.
            Some(req) = to_service_rx.recv() => {
                let mut bytes = serde_json::to_vec(&req).unwrap_or_default();
                bytes.push(b'\n');
                if pipe_w.write_all(&bytes).await.is_err() {
                    break;
                }
            }
            // Inbound: service state/events → translate to the extension.
            line = lines.next_line() => {
                let line = match line? {
                    Some(l) => l,
                    None => break, // pipe closed
                };
                let Ok(v) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                let mut changed = false;
                match v.get("kind").and_then(|k| k.as_str()) {
                    // Only the getState response (id 1) carries the blocking snapshot.
                    Some("response")
                        if v.get("ok").and_then(|o| o.as_bool()) == Some(true)
                            && v.get("id").and_then(|i| i.as_i64()) == Some(GET_STATE_ID) =>
                    {
                        if let Some(result) = v.get("result") {
                            if let Some(active) = result.get("focusActive").and_then(|x| x.as_bool()) {
                                b.active = active;
                            }
                            if let Some(policy) = result.get("policy") {
                                parse_policy(policy, &mut b);
                            }
                            changed = true;
                        }
                    }
                    Some("response")
                        if v.get("ok").and_then(|o| o.as_bool()) == Some(true) =>
                    {
                        if let Some(ack) = heartbeat_ack(&v) {
                            let _ = out_tx.send(ack);
                        }
                    }
                    Some("event") => match v.get("event").and_then(|e| e.as_str()) {
                        Some("focusChanged") => {
                            if let Some(active) = v.pointer("/payload/active").and_then(|x| x.as_bool()) {
                                b.active = active;
                                changed = true;
                            }
                        }
                        Some("policyChanged") => {
                            if let Some(policy) = v.pointer("/payload/policy") {
                                parse_policy(policy, &mut b);
                                changed = true;
                            }
                        }
                        _ => {}
                    },
                    _ => {}
                }
                if changed {
                    let push = {
                        let mut guard = last.lock().await;
                        if guard.as_ref() != Some(&b) {
                            *guard = Some(b.clone());
                            true
                        } else {
                            false
                        }
                    };
                    if push {
                        let _ = out_tx.send(b.to_msg());
                    }
                }
            }
        }
    }
    Ok(())
}

/// Read one native-messaging frame (4-byte LE length + JSON). Ok(None) on clean EOF.
async fn read_frame<R: AsyncReadExt + Unpin>(r: &mut R) -> std::io::Result<Option<Value>> {
    let mut len_buf = [0u8; 4];
    match r.read_exact(&mut len_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_le_bytes(len_buf);
    if len == 0 || len > MAX_FRAME {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "bad native-messaging frame length",
        ));
    }
    let mut buf = vec![0u8; len as usize];
    r.read_exact(&mut buf).await?;
    Ok(serde_json::from_slice(&buf).ok())
}

/// Write one native-messaging frame (4-byte LE length + JSON).
async fn write_frame<W: AsyncWriteExt + Unpin>(w: &mut W, msg: &Value) -> std::io::Result<()> {
    let body = serde_json::to_vec(msg)?;
    let len = body.len() as u32;
    w.write_all(&len.to_le_bytes()).await?;
    w.write_all(&body).await?;
    w.flush().await?;
    Ok(())
}
