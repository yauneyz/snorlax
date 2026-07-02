//! talysman-svc.exe — the privileged service.
//!
//! Two entry paths:
//!   * default: registered with the Service Control Manager (LocalSystem, auto-start).
//!   * `--console`: run in the foreground for development (Ctrl-C to stop). Uses the dev pipe
//!     name unless TALYSMAN_PIPE overrides it.

use std::ffi::OsString;
use std::time::Duration;

use tokio::sync::watch;

use talysman::constants::{pipe_path, PIPE_BASE_DEV, PIPE_BASE_PROD, SERVICE_NAME};
use talysman::paths;
use talysman::service;

fn resolve_pipe(default_base: &str) -> String {
    let base = std::env::var("TALYSMAN_PIPE").unwrap_or_else(|_| default_base.to_string());
    pipe_path(&base)
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

    if console {
        init_tracing(false);
        tracing::info!("starting Talysman service in console (dev) mode");
        let (tx, rx) = watch::channel(false);
        ctrlc_set_handler(tx);
        service::run_blocking(resolve_pipe(PIPE_BASE_DEV), rx);
        return Ok(());
    }

    // SCM-managed path.
    init_tracing(true);
    windows_service::service_dispatcher::start(SERVICE_NAME, ffi_service_main)?;
    Ok(())
}

/// Minimal Ctrl-C handler for console mode (no extra crate: poll a flag via std thread).
fn ctrlc_set_handler(tx: watch::Sender<bool>) {
    // We avoid the `ctrlc` crate; instead spawn a thread that waits on stdin EOF / Ctrl-C is
    // delivered by the OS terminating the process. As a portable stop, also handle Ctrl-C via
    // a simple SetConsoleCtrlHandler-free approach: block on a line from stdin = "quit".
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
}

// ---- SCM glue ----

windows_service::define_windows_service!(ffi_service_main, service_main);

fn service_main(_args: Vec<OsString>) {
    if let Err(e) = run_scm_service() {
        tracing::error!("service error: {e}");
    }
}

fn run_scm_service() -> anyhow::Result<()> {
    use windows_service::service::{
        ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
        ServiceType,
    };
    use windows_service::service_control_handler::{self, ServiceControlHandlerResult};

    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let event_handler = move |control: ServiceControl| -> ServiceControlHandlerResult {
        match control {
            ServiceControl::Stop | ServiceControl::Shutdown => {
                let _ = shutdown_tx.send(true);
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        }
    };

    let status_handle = service_control_handler::register(SERVICE_NAME, event_handler)?;

    let running = ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Running,
        controls_accepted: ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN,
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    };
    status_handle.set_service_status(running)?;

    tracing::info!("Talysman service entering run loop");
    service::run_blocking(resolve_pipe(PIPE_BASE_PROD), shutdown_rx);

    let stopped = ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Stopped,
        controls_accepted: ServiceControlAccept::empty(),
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    };
    status_handle.set_service_status(stopped)?;
    Ok(())
}
