//! Browser native-messaging host for Linux.

use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::AsyncBufReadExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::{mpsc, Mutex};

use focuslock::constants::{socket_path, PIPE_BASE_DEV, PIPE_BASE_PROD};

const MAX_FRAME: u32 = 1024 * 1024;

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

#[tokio::main]
async fn main() {
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Value>();
    tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(msg) = out_rx.recv().await {
            if write_frame(&mut stdout, &msg).await.is_err() {
                break;
            }
        }
    });

    let last: Arc<Mutex<Option<Blocking>>> = Arc::new(Mutex::new(None));

    {
        let out_tx = out_tx.clone();
        let last = last.clone();
        tokio::spawn(async move {
            let mut stdin = tokio::io::stdin();
            loop {
                match read_frame(&mut stdin).await {
                    Ok(Some(_msg)) => {
                        if let Some(b) = last.lock().await.clone() {
                            let _ = out_tx.send(b.to_msg());
                        }
                    }
                    _ => std::process::exit(0),
                }
            }
        });
    }

    loop {
        let _ = pump_socket(&out_tx, &last).await;
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

async fn pump_socket(
    out_tx: &mpsc::UnboundedSender<Value>,
    last: &Arc<Mutex<Option<Blocking>>>,
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
        let line = match lines.next_line().await? {
            Some(l) => l,
            None => break,
        };
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let mut changed = false;
        match v.get("kind").and_then(|k| k.as_str()) {
            Some("response") if v.get("ok").and_then(|o| o.as_bool()) == Some(true) => {
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
