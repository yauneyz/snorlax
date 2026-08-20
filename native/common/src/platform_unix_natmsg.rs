// Shared Unix browser native-messaging host. Bridges the extension to the privileged service over
// the Unix socket and exits with the browser-owned native-messaging port.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::AsyncBufReadExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::{mpsc, watch, Mutex};

use talysman::constants::{socket_path, PIPE_BASE_DEV, PIPE_BASE_PROD};

const MAX_FRAME: u32 = 1024 * 1024;

/// RPC id for the initial `getState` (its response carries the authoritative snapshot). Heartbeat
/// relays use ids from `NEXT_ID` so their responses are ignored by the state parser.
const GET_STATE_ID: i64 = 1;
static NEXT_ID: AtomicU64 = AtomicU64::new(2);

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
    smart_filtering_enabled: bool,
}

impl Blocking {
    fn to_msg(&self) -> Value {
        let default_action = if self.default_action.is_empty() {
            "allow"
        } else {
            self.default_action.as_str()
        };
        json!({
            "type": "state",
            "active": self.active,
            "blockedDomains": self.blocked_domains,
            "allowedDomains": self.allowed_domains,
            "defaultAction": default_action,
            "intent": if self.smart_filtering_enabled { self.intent.clone() } else { Value::Null },
            "handshakeEnabled": self.handshake_enabled,
        })
    }
}

/// Mirrors the shared `Policy` shape onto the state frame the extension
/// consumes (`apps/extension/src/background.js`'s `applyState`): independent `blockedDomains`/
/// `allowedDomains` hard lists, a `defaultAction` fallback, and an optional `intent` that turns
/// on Smart filtering for pages hitting neither hard list. This is a direct field-for-field
/// passthrough.
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

/// The PID of the process that launched us — the browser.
fn parent_pid() -> u32 {
    #[cfg(target_os = "linux")]
    {
        let stat = std::fs::read_to_string("/proc/self/stat").unwrap_or_default();
        if let Some(idx) = stat.rfind(')') {
            let mut it = stat[idx + 1..].split_whitespace();
            let _state = it.next();
            if let Some(ppid) = it.next() {
                return ppid.parse().unwrap_or(0);
            }
        }
        0
    }
    #[cfg(target_os = "macos")]
    {
        std::os::unix::process::parent_id()
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
    let browser_pid = parent_pid();

    let (out_tx, mut out_rx) = mpsc::channel::<Value>(64);
    tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(msg) = out_rx.recv().await {
            if write_frame(&mut stdout, &msg).await.is_err() {
                break;
            }
        }
    });

    let last: Arc<Mutex<Option<Blocking>>> = Arc::new(Mutex::new(None));

    // Heartbeats are state, not a work queue: retain only the latest while disconnected. Judge
    // requests remain bounded work so a broken service cannot grow this laptop process forever.
    let (heartbeat_tx, heartbeat_rx) = watch::channel::<Option<Value>>(None);
    let (judge_tx, mut judge_rx) = mpsc::channel::<Value>(64);

    {
        let out_tx = out_tx.clone();
        let last = last.clone();
        tokio::spawn(async move {
            let mut stdin = tokio::io::stdin();
            loop {
                match read_frame(&mut stdin).await {
                    Ok(Some(msg)) => match msg.get("type").and_then(|t| t.as_str()) {
                        Some("heartbeat") => {
                            let _ = heartbeat_tx.send(Some(heartbeat_request(&msg, browser_pid)));
                        }
                        Some("judge-request") => {
                            let _ = judge_tx.send(judge_request(&msg)).await;
                        }
                        // `hello` (or anything else): resend the latest state to the browser.
                        _ => {
                            if let Some(b) = last.lock().await.clone() {
                                let _ = out_tx.send(b.to_msg()).await;
                            }
                        }
                    },
                    // EOF or error: the port is gone. Native-messaging hosts exit with their port.
                    _ => std::process::exit(0),
                }
            }
        });
    }

    loop {
        let _ = pump_socket(&out_tx, &last, heartbeat_rx.clone(), &mut judge_rx).await;
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

async fn pump_socket(
    out_tx: &mpsc::Sender<Value>,
    last: &Arc<Mutex<Option<Blocking>>>,
    mut heartbeat_rx: watch::Receiver<Option<Value>>,
    judge_rx: &mut mpsc::Receiver<Value>,
) -> std::io::Result<()> {
    let client = match UnixStream::connect(socket_path(PIPE_BASE_PROD)).await {
        Ok(client) => client,
        Err(_) => UnixStream::connect(socket_path(PIPE_BASE_DEV)).await?,
    };

    let (reader, mut pipe_w) = tokio::io::split(client);
    pipe_w
        .write_all(b"{\"kind\":\"request\",\"id\":1,\"method\":\"getState\",\"params\":null}\n")
        .await?;

    let mut b = Blocking::default();
    let mut lines = BufReader::new(reader).lines();
    loop {
        tokio::select! {
            changed = heartbeat_rx.changed() => {
                if changed.is_err() { break; }
                let Some(req) = heartbeat_rx.borrow_and_update().clone() else { continue; };
                let mut bytes = serde_json::to_vec(&req).unwrap_or_default();
                bytes.push(b'\n');
                if pipe_w.write_all(&bytes).await.is_err() { break; }
            }
            Some(req) = judge_rx.recv() => {
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
                    None => break, // socket closed
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
                            if let Some(enabled) = result.pointer("/settings/smartFilteringEnabled").and_then(Value::as_bool) {
                                b.smart_filtering_enabled = enabled;
                            }
                            changed = true;
                        }
                    }
                    Some("response")
                        if v.get("ok").and_then(|o| o.as_bool()) == Some(true) =>
                    {
                        if let Some(ack) = heartbeat_ack(&v) {
                            let _ = out_tx.send(ack).await;
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
                            if let Some(enabled) = v.pointer("/payload/settings/smartFilteringEnabled").and_then(Value::as_bool) {
                                b.smart_filtering_enabled = enabled;
                                changed = true;
                            }
                        }
                        Some("judgeResult") => {
                            if let Some(payload) = v.get("payload") {
                                let _ = out_tx.send(judge_result_frame(payload)).await;
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
                        let _ = out_tx.send(b.to_msg()).await;
                    }
                }
            }
        }
    }
    Ok(())
}

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

async fn write_frame<W: AsyncWriteExt + Unpin>(w: &mut W, msg: &Value) -> std::io::Result<()> {
    let body = serde_json::to_vec(msg)?;
    let len = body.len() as u32;
    w.write_all(&len.to_le_bytes()).await?;
    w.write_all(&body).await?;
    w.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_frame_is_canonical_and_product_gate_controls_only_intent() {
        let mut blocking = Blocking {
            active: true,
            blocked_domains: vec!["reddit.com".into()],
            default_action: "allow".into(),
            intent: json!({ "positive": "write a thesis" }),
            ..Blocking::default()
        };

        let classic = blocking.to_msg();
        assert_eq!(classic["blockedDomains"][0], "reddit.com");
        assert!(classic["intent"].is_null());
        assert!(classic.get("mode").is_none());
        assert!(classic.get("domains").is_none());

        blocking.smart_filtering_enabled = true;
        assert_eq!(blocking.to_msg()["intent"]["positive"], "write a thesis");
    }
}
