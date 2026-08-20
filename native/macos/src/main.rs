//! talysman-svc for macOS. Runs as a foreground process under launchd, or with --console for dev.

use tokio::sync::watch;

use talysman::constants::{socket_path, PIPE_BASE_DEV, PIPE_BASE_PROD};
use talysman::paths;
use talysman::service;

fn resolve_socket(default_base: &str) -> String {
    if let Ok(path) = std::env::var("TALYSMAN_SOCKET") {
        return path;
    }
    let base = std::env::var("TALYSMAN_PIPE").unwrap_or_else(|_| default_base.to_string());
    socket_path(&base)
}

fn init_tracing(to_file: bool) {
    let _ = paths::ensure_data_dir();
    let builder = tracing_subscriber::fmt().with_ansi(!to_file);
    if to_file {
        let path = paths::log_file();
        let oversized = path
            .metadata()
            .map(|m| m.len() > 2 * 1024 * 1024)
            .unwrap_or(false);
        let mut options = std::fs::OpenOptions::new();
        options.create(true).write(true);
        if oversized {
            options.truncate(true);
        } else {
            options.append(true);
        }
        let file = options.open(&path).expect("open log file");
        builder.with_writer(file).init();
    } else {
        builder.init();
    }
    // The subscriber exists now, so panics can be logged. Enforcement runs on dedicated threads
    // and spawned tasks whose panics would otherwise be silent - see panic_log for why that is a
    // fail-open rather than a nuisance.
    talysman_common::panic_log::install();
}

fn main() -> anyhow::Result<()> {
    let console = std::env::args().any(|a| a == "--console");
    init_tracing(!console);

    let (tx, rx) = watch::channel(false);
    if console {
        tracing::info!("starting Talysman service in macOS console mode");
        std::thread::spawn(move || {
            use std::io::BufRead;
            let stdin = std::io::stdin();
            for line in stdin.lock().lines().map_while(Result::ok) {
                if line.trim().eq_ignore_ascii_case("quit") {
                    let _ = tx.send(true);
                    return;
                }
            }
            // stdin ended without a "quit" — it was redirected, or no console is attached.
            // Dropping `tx` here is not a no-op: with the sender gone every `shutdown.changed()`
            // in the service resolves `Err` immediately and forever, so every `tokio::select!`
            // waiting on it spins. The IPC accept loop stops waiting for clients entirely, which
            // reads exactly like a hung service while burning a core. Park to keep `tx` alive.
            loop {
                std::thread::park();
            }
        });
        service::run_blocking(resolve_socket(PIPE_BASE_DEV), rx);
    } else {
        tracing::info!("starting Talysman service under launchd");
        service::run_blocking(resolve_socket(PIPE_BASE_PROD), rx);
    }
    Ok(())
}
