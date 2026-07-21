//! talysman-svcctl.exe — the elevated install/configure/recover/remove CLI (architecture
//! §4, §13). Invoked by the NSIS installer (and usable by support). Must run as administrator.
//!
//! Subcommands:
//!   install     create + auto-start the service, configure SCM restart recovery, and generate
//!               the one-time recovery code (prints it + writes recovery-code.txt)
//!   uninstall   stop + delete the service
//!   start | stop | status
//!   gen-code    regenerate the recovery code

use std::ffi::OsString;
use std::time::Duration;

use anyhow::{Context, Result};

use talysman::constants::{pipe_path, PIPE_BASE_PROD, SERVICE_DISPLAY_NAME, SERVICE_NAME};
use talysman::pairing;
use talysman::paths;
use talysman::secure_store::SecureStore;
use windows::Win32::Foundation::ERROR_SERVICE_EXISTS;

use windows_service::service::{
    ServiceAccess, ServiceAction, ServiceActionType, ServiceErrorControl, ServiceFailureActions,
    ServiceFailureResetPeriod, ServiceInfo, ServiceStartType, ServiceState, ServiceType,
};
use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};

fn svc_exe_path() -> Result<std::path::PathBuf> {
    let dir = std::env::current_exe()?
        .parent()
        .context("no parent dir for current exe")?
        .to_path_buf();
    Ok(dir.join("talysman-svc.exe"))
}

fn install() -> Result<()> {
    let manager = ServiceManager::local_computer(
        None::<&str>,
        ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE,
    )?;

    let service_info = service_info()?;
    let access = ServiceAccess::CHANGE_CONFIG
        | ServiceAccess::START
        | ServiceAccess::STOP
        | ServiceAccess::QUERY_STATUS;
    let service = match manager.create_service(&service_info, access) {
        Ok(service) => {
            println!("Service '{SERVICE_NAME}' created.");
            service
        }
        Err(windows_service::Error::Winapi(err))
            if err.raw_os_error() == Some(ERROR_SERVICE_EXISTS.0 as i32) =>
        {
            println!("Service '{SERVICE_NAME}' already exists; repairing configuration.");
            let service = manager.open_service(SERVICE_NAME, access)?;
            stop_if_running(&service)?;
            service
                .change_config(&service_info)
                .context("update service configuration")?;
            service
        }
        Err(err) => return Err(err.into()),
    };

    // Installation is also the repair/upgrade path. Never rotate the killswitch during an
    // application update: generate it once, before the service first reads the store.
    ensure_recovery_code()?;
    talysman::enforce::extension_policy::install();
    configure_service(&service)?;
    start_if_needed(&service)?;
    Ok(())
}

fn service_info() -> Result<ServiceInfo> {
    Ok(ServiceInfo {
        name: OsString::from(SERVICE_NAME),
        display_name: OsString::from(SERVICE_DISPLAY_NAME),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: ServiceErrorControl::Normal,
        executable_path: svc_exe_path()?,
        launch_arguments: vec![],
        dependencies: vec![],
        account_name: None, // LocalSystem
        account_password: None,
    })
}

fn configure_service(service: &windows_service::service::Service) -> Result<()> {
    // SCM recovery: restart three times with a 1s delay, resetting the count daily.
    let actions = vec![
        ServiceAction {
            action_type: ServiceActionType::Restart,
            delay: Duration::from_secs(1),
        },
        ServiceAction {
            action_type: ServiceActionType::Restart,
            delay: Duration::from_secs(1),
        },
        ServiceAction {
            action_type: ServiceActionType::Restart,
            delay: Duration::from_secs(1),
        },
    ];
    let failure_actions = ServiceFailureActions {
        reset_period: ServiceFailureResetPeriod::After(Duration::from_secs(86_400)),
        reboot_msg: None,
        command: None,
        actions: Some(actions),
    };
    service
        .update_failure_actions(failure_actions)
        .context("set SCM recovery actions")?;

    // NOTE: LocalSystem services already deny STOP/DELETE to non-admins by default DACL.
    // A tighter explicit DACL (deny even other admins) is a documented hardening upgrade.

    Ok(())
}

fn stop_if_running(service: &windows_service::service::Service) -> Result<()> {
    let status = service.query_status().context("query service status")?;
    if status.current_state == ServiceState::Stopped {
        println!("Service '{SERVICE_NAME}' is already stopped.");
        return Ok(());
    }

    println!("Stopping existing service '{SERVICE_NAME}'.");
    if status.current_state != ServiceState::StopPending {
        service.stop().context("stop service")?;
    }

    for _ in 0..30 {
        let status = service.query_status().context("query service status")?;
        if status.current_state == ServiceState::Stopped {
            println!("Service '{SERVICE_NAME}' stopped.");
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(500));
    }

    anyhow::bail!("service did not stop within 15 seconds");
}

fn start_if_needed(service: &windows_service::service::Service) -> Result<()> {
    let status = service.query_status().context("query service status")?;
    if status.current_state == ServiceState::Stopped {
        service.start::<OsString>(&[]).context("start service")?;
        println!("Service '{SERVICE_NAME}' started.");
    } else {
        println!("Service '{SERVICE_NAME}' is {:?}.", status.current_state);
    }
    Ok(())
}

fn uninstall() -> Result<()> {
    // Clean up registration even if the Windows service was already removed or damaged.
    talysman::enforce::extension_policy::uninstall();
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    let service = manager.open_service(
        SERVICE_NAME,
        ServiceAccess::STOP | ServiceAccess::DELETE | ServiceAccess::QUERY_STATUS,
    )?;
    let _ = service.stop();
    service.delete()?;
    println!("Service '{SERVICE_NAME}' deleted.");
    Ok(())
}

fn start() -> Result<()> {
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    let service = manager.open_service(SERVICE_NAME, ServiceAccess::START)?;
    service.start::<OsString>(&[])?;
    println!("started");
    Ok(())
}

fn stop() -> Result<()> {
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    let service = manager.open_service(SERVICE_NAME, ServiceAccess::STOP)?;
    service.stop()?;
    println!("stop signalled");
    Ok(())
}

fn status() -> Result<()> {
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    let service = manager.open_service(SERVICE_NAME, ServiceAccess::QUERY_STATUS)?;
    let s = service.query_status()?;
    println!("state: {:?}", s.current_state);
    Ok(())
}

/// Generate a fresh recovery code, store its hash, and surface the plaintext once.
fn gen_code() -> Result<()> {
    let code = pairing::generate_recovery_code();
    let mut store = SecureStore::load();
    store.recovery = Some(pairing::hash_recovery_code(&code));
    store.save().context("save secure store")?;

    let path = paths::recovery_code_file();
    let _ = std::fs::write(&path, format!("Talysman recovery code: {code}\n"));

    println!("\n==================== Talysman RECOVERY CODE ====================");
    println!("  {code}");
    println!("  Save this somewhere safe. If you ever get locked out and can't");
    println!("  use your USB key, run:  talysman-recover.exe --code {code}");
    println!("  (also written to {})", path.display());
    println!("================================================================\n");
    Ok(())
}

fn ensure_recovery_code() -> Result<()> {
    if SecureStore::load().recovery.is_some() {
        println!(
            "Existing Talysman recovery code preserved ({}).",
            paths::recovery_code_file().display()
        );
        return Ok(());
    }
    gen_code()
}

/// Exit 10 if focus is active AND no paired key is present (so the NSIS uninstaller can abort).
/// If the service can't be reached, allow uninstall (exit 0).
fn guard_uninstall() -> Result<()> {
    use std::fs::OpenOptions;
    use std::io::{BufRead, BufReader, Write};

    let path = pipe_path(PIPE_BASE_PROD);
    let file = match OpenOptions::new().read(true).write(true).open(&path) {
        Ok(f) => f,
        Err(_) => return Ok(()), // service not running → nothing to guard
    };

    (&file)
        .write_all(b"{\"kind\":\"request\",\"id\":1,\"method\":\"getState\",\"params\":{}}\n")?;

    let mut reader = BufReader::new(&file);
    let mut line = String::new();
    while reader.read_line(&mut line)? != 0 {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) {
            if v.get("kind").and_then(|k| k.as_str()) == Some("response") {
                let r = &v["result"];
                let focus = r["focusActive"].as_bool().unwrap_or(false);
                let key = r["keyPresent"].as_bool().unwrap_or(false);
                if focus && !key {
                    eprintln!("uninstall blocked: focus active and no key present");
                    std::process::exit(10);
                }
                return Ok(());
            }
        }
        line.clear();
    }
    Ok(())
}

fn main() {
    let cmd = std::env::args().nth(1).unwrap_or_else(|| "help".into());
    let result = match cmd.as_str() {
        "install" => install(),
        "uninstall" => uninstall(),
        "start" => start(),
        "stop" => stop(),
        "status" => status(),
        "gen-code" => gen_code(),
        "guard-uninstall" => guard_uninstall(),
        _ => {
            eprintln!(
                "usage: talysman-svcctl <install|uninstall|start|stop|status|gen-code|guard-uninstall>"
            );
            std::process::exit(2);
        }
    };
    if let Err(e) = result {
        eprintln!("error: {e:#}");
        std::process::exit(1);
    }
}
