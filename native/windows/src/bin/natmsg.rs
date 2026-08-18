//! talysman-natmsg.exe — the browser native-messaging host that bridges the Talysman extension
//! to the privileged service.
//!
//! Browsers can't talk to our named pipe, so the extension speaks Chrome/Firefox **native
//! messaging** (4-byte little-endian length prefix + UTF-8 JSON on stdio) to this host, which the
//! browser spawns. Two directions:
//!   - service → extension: the minimal blocking state the extension needs:
//!       { "type": "state", "active": bool, "blockedDomains": [..], "allowedDomains": [..],
//!         "defaultAction": "allow"|"block", "intent": {positive, negative}|null }
//!   - extension → service: Smart-filtering `judge-request` frames are relayed as `judgeRequest`
//!     RPCs and answered later by a `judgeResult` event (relayed back as `judge-result`).
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
    blocked_domains: Vec<String>,
    allowed_domains: Vec<String>,
    default_action: String,
    /// Raw JSON so a `null` intent round-trips as JSON `null` rather than `{}`. `Value::Null` by
    /// default, matching "no Smart filtering" for a freshly-constructed `Blocking`.
    intent: Value,
    handshake_enabled: bool,
}

impl Blocking {
    fn to_msg(&self) -> Value {
        let default_action = if self.default_action.is_empty() {
            "allow"
        } else {
            self.default_action.as_str()
        };
        // `mode`/`domains` are the pre-Smart-filtering shape. The published 0.2.1 extension
        // switches on them and applies zero DNR rules when they are missing, so it stops blocking
        // entirely against a current daemon. Emit both shapes until that build has rolled over;
        // current extensions read the fields below and ignore these two.
        let (mode, domains) = talysman_common::extension_compat::legacy_state_fields(
            default_action,
            &self.blocked_domains,
            &self.allowed_domains,
        );
        json!({
            "type": "state",
            "active": self.active,
            "mode": mode,
            "domains": domains,
            "blockedDomains": self.blocked_domains,
            "allowedDomains": self.allowed_domains,
            "defaultAction": default_action,
            "intent": self.intent,
            "handshakeEnabled": self.handshake_enabled,
        })
    }
}

/// Mirrors the `Policy` shape onto the state frame the extension consumes
/// (`apps/extension/src/background.js`'s `applyState`): independent `blockedDomains`/
/// `allowedDomains` hard lists, a `defaultAction` fallback, and an optional `intent` that turns
/// on Smart filtering for pages hitting neither hard list. This is a direct field-for-field
/// passthrough — no legacy mode/domains synthesis.
fn parse_policy(policy: &Value, b: &mut Blocking) {
    b.blocked_domains = policy
        .get("blockedDomains")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|d| d.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    b.allowed_domains = policy
        .get("allowedDomains")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|d| d.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    b.default_action = if policy.get("defaultAction").and_then(|v| v.as_str()) == Some("block") {
        "block".to_string()
    } else {
        "allow".to_string()
    };
    b.intent = policy.get("intent").cloned().unwrap_or(Value::Null);
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
        "params": talysman_common::extension_compat::relay_heartbeat_params(frame, browser_pid),
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

/// Build a `judgeRequest` RPC from the extension's `judge-request` frame. Fire-and-forget: the
/// RPC just acks `Ok`, the real answer arrives later as a `judgeResult` event (see
/// `judge_result_frame`). No id correlation needed — the daemon owns the pending-request state.
fn judge_request(frame: &Value) -> Value {
    json!({
        "kind": "request",
        "id": NEXT_ID.fetch_add(1, Ordering::Relaxed),
        "method": "judgeRequest",
        "params": {
            "requestId": frame.get("requestId").cloned().unwrap_or(Value::Null),
            "url": frame.get("url").cloned().unwrap_or(Value::Null),
            "extractedText": frame.get("extractedText").cloned().unwrap_or(Value::Null),
        },
    })
}

/// Translate a `judgeResult` event straight into the outbound `judge-result` frame for the
/// browser. Pure relay: no state cached, no id correlation.
fn judge_result_frame(payload: &Value) -> Value {
    json!({
        "type": "judge-result",
        "requestId": payload.get("requestId").cloned().unwrap_or(Value::Null),
        "url": payload.get("url").cloned().unwrap_or(Value::Null),
        "relevant": payload.get("relevant").cloned().unwrap_or(Value::Null),
        "reason": payload.get("reason").cloned().unwrap_or(Value::Null),
    })
}

#[tokio::main(flavor = "current_thread")]
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
                        Some("judge-request") => {
                            let _ = to_service_tx.send(judge_request(&msg));
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

    fn blocking(default_action: &str, blocked: &[&str], allowed: &[&str]) -> Blocking {
        Blocking {
            active: true,
            blocked_domains: blocked.iter().map(|d| d.to_string()).collect(),
            allowed_domains: allowed.iter().map(|d| d.to_string()).collect(),
            default_action: default_action.to_string(),
            intent: Value::Null,
            handshake_enabled: true,
        }
    }

    /// The published 0.2.1 extension switches on `mode` and reads `domains`; dropping those fields
    /// makes it apply zero DNR rules and silently stop blocking. Both shapes must ship together.
    #[test]
    fn the_state_frame_carries_both_the_legacy_and_current_shapes() {
        let msg = blocking("allow", &["reddit.com"], &[]).to_msg();

        assert_eq!(msg["mode"], "blacklist");
        assert_eq!(msg["domains"][0], "reddit.com");
        assert_eq!(msg["blockedDomains"][0], "reddit.com");
        assert_eq!(msg["defaultAction"], "allow");
    }

    #[test]
    fn a_default_deny_policy_reaches_the_old_extension_as_a_whitelist() {
        let msg = blocking("block", &[], &["docs.rs"]).to_msg();

        assert_eq!(msg["mode"], "whitelist");
        assert_eq!(msg["domains"][0], "docs.rs");
        assert_eq!(msg["allowedDomains"][0], "docs.rs");
        assert_eq!(msg["defaultAction"], "block");
    }

    /// An unset `default_action` is the freshly-constructed `Blocking`, before any `getState`
    /// response has landed. It must still read as the open-by-default preset, not an empty string.
    #[test]
    fn an_unset_default_action_falls_back_to_allow() {
        let msg = Blocking::default().to_msg();

        assert_eq!(msg["defaultAction"], "allow");
        assert_eq!(msg["mode"], "blacklist");
    }

    #[test]
    fn a_judge_request_frame_becomes_a_judge_request_rpc() {
        let rpc = judge_request(&json!({
            "type": "judge-request",
            "requestId": "req-1",
            "url": "https://example.com/a",
            "extractedText": "some page text",
        }));

        assert_eq!(rpc["method"], "judgeRequest");
        assert_eq!(rpc["params"]["requestId"], "req-1");
        assert_eq!(rpc["params"]["url"], "https://example.com/a");
        assert_eq!(rpc["params"]["extractedText"], "some page text");
    }

    #[test]
    fn a_judge_result_event_becomes_the_extension_judge_result_frame() {
        let frame = judge_result_frame(&json!({
            "requestId": "req-1",
            "url": "https://example.com/a",
            "relevant": false,
            "reason": "off task",
        }));

        assert_eq!(frame["type"], "judge-result");
        assert_eq!(frame["requestId"], "req-1");
        assert_eq!(frame["relevant"], false);
        assert_eq!(frame["reason"], "off task");
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
                            if let Some(enabled) = result.pointer("/settings/browserHandshakeEnabled").and_then(Value::as_bool) {
                                b.handshake_enabled = enabled;
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
                        Some("settingsChanged") => {
                            if let Some(enabled) = v.pointer("/payload/settings/browserHandshakeEnabled").and_then(Value::as_bool) {
                                b.handshake_enabled = enabled;
                                changed = true;
                            }
                        }
                        Some("judgeResult") => {
                            if let Some(payload) = v.get("payload") {
                                let _ = out_tx.send(judge_result_frame(payload));
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
