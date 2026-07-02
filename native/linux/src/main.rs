//! talysman-svc for Linux. Runs as a foreground process under systemd, or with --console for dev.

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
        builder
            .with_writer(move || {
                std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&path)
                    .unwrap_or_else(|_| std::fs::File::create(&path).expect("open log file"))
            })
            .init();
    } else {
        builder.init();
    }
}

fn main() -> anyhow::Result<()> {
    let console = std::env::args().any(|a| a == "--console");
    init_tracing(!console);

    let (tx, rx) = watch::channel(false);
    if console {
        tracing::info!("starting Talysman service in Linux console mode");
        std::thread::spawn(move || {
            use std::io::BufRead;
            let stdin = std::io::stdin();
            for line in stdin.lock().lines().map_while(Result::ok) {
                if line.trim().eq_ignore_ascii_case("quit") {
                    let _ = tx.send(true);
                    break;
                }
            }
        });
        service::run_blocking(resolve_socket(PIPE_BASE_DEV), rx);
    } else {
        tracing::info!("starting Talysman service under systemd");
        service::run_blocking(resolve_socket(PIPE_BASE_PROD), rx);
    }
    Ok(())
}
