//! Shared client for the focus-enable / focus-disable CLIs.
//!
//! Connects to the running service over its NDJSON-RPC Unix socket and calls
//! `enableFocus` / `disableFocus`. The service is the source of truth: when
//! disabling, it re-checks USB-key presence itself and refuses with
//! `KEY_REQUIRED` if no paired key is inserted, which we surface to the user.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::process::ExitCode;

use serde_json::Value;

use crate::constants::{socket_path, PIPE_BASE_DEV, PIPE_BASE_PROD};

/// Connect to the running service socket (prod, then dev fallback).
fn connect() -> Option<UnixStream> {
    for base in [PIPE_BASE_PROD, PIPE_BASE_DEV] {
        if let Ok(s) = UnixStream::connect(socket_path(base)) {
            return Some(s);
        }
    }
    None
}

/// Send a single NDJSON request and return the parsed response envelope.
fn request(mut stream: UnixStream, method: &str) -> std::io::Result<Value> {
    let req = format!("{{\"kind\":\"request\",\"id\":1,\"method\":\"{method}\",\"params\":{{}}}}\n");
    stream.write_all(req.as_bytes())?;

    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    while reader.read_line(&mut line)? != 0 {
        if let Ok(v) = serde_json::from_str::<Value>(line.trim()) {
            if v.get("kind").and_then(|k| k.as_str()) == Some("response") {
                return Ok(v);
            }
        }
        line.clear();
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::UnexpectedEof,
        "no response from service",
    ))
}

/// Run the enable (`true`) or disable (`false`) command and return its exit code.
pub fn run(enable: bool) -> ExitCode {
    let Some(stream) = connect() else {
        eprintln!(
            "FocusLock service is not running (could not connect to {}).",
            socket_path(PIPE_BASE_PROD)
        );
        return ExitCode::FAILURE;
    };

    let method = if enable { "enableFocus" } else { "disableFocus" };
    let resp = match request(stream, method) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("error talking to FocusLock service: {e}");
            return ExitCode::FAILURE;
        }
    };

    if resp.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        println!(
            "Focus blocking {}.",
            if enable { "enabled" } else { "disabled" }
        );
        ExitCode::SUCCESS
    } else {
        // Surfaces the daemon's own message, e.g. "Insert your paired key to
        // unlock." (KEY_REQUIRED) or the locked-schedule message (LOCKED).
        let msg = resp
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("request rejected");
        eprintln!("{msg}");
        ExitCode::FAILURE
    }
}
