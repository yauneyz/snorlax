//! talysman-svcctl.exe — the elevated install/configure/remove CLI (architecture
//! §4, §13). Invoked by the NSIS installer (and usable by support). Must run as administrator.
//!
//! Subcommands:
//!   install     create + auto-start the service and configure SCM restart actions
//!   uninstall   stop + delete the service
//!   start | stop | status

use std::ffi::OsString;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};

use talysman::constants::{pipe_path, PIPE_BASE_PROD, SERVICE_DISPLAY_NAME, SERVICE_NAME};
use windows::Win32::Foundation::{ERROR_SERVICE_DOES_NOT_EXIST, ERROR_SERVICE_EXISTS};

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

    // Installation is also the repair/upgrade path for the service and native-host manifest.
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
    const STOP_TIMEOUT: Duration = Duration::from_secs(30);
    const POLL_INTERVAL: Duration = Duration::from_millis(250);

    let deadline = Instant::now() + STOP_TIMEOUT;
    let mut stop_sent = false;
    loop {
        let status = service.query_status().context("query service status")?;
        match status.current_state {
            ServiceState::Stopped => {
                println!("Service '{SERVICE_NAME}' stopped.");
                return Ok(());
            }
            ServiceState::Running | ServiceState::Paused if !stop_sent => {
                println!("Stopping service '{SERVICE_NAME}'.");
                service.stop().context("send service stop control")?;
                stop_sent = true;
            }
            // A service cannot always accept STOP while another transition is pending. Keep
            // polling; once it reaches Running/Paused the branch above sends the control.
            ServiceState::StartPending
            | ServiceState::ContinuePending
            | ServiceState::PausePending
            | ServiceState::StopPending
            | ServiceState::Running
            | ServiceState::Paused => {}
        }

        if Instant::now() >= deadline {
            anyhow::bail!(
                "service did not stop within {} seconds (last state: {:?})",
                STOP_TIMEOUT.as_secs(),
                status.current_state
            );
        }
        std::thread::sleep(POLL_INTERVAL);
    }
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
    // Keep the standalone controller as safe as the NSIS path. The uninstaller runs this check
    // first to provide a tailored message, but administrators may also invoke svcctl directly.
    guard_uninstall()?;

    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    let service = match manager.open_service(
        SERVICE_NAME,
        ServiceAccess::STOP | ServiceAccess::DELETE | ServiceAccess::QUERY_STATUS,
    ) {
        Ok(service) => Some(service),
        Err(windows_service::Error::Winapi(err))
            if err.raw_os_error() == Some(ERROR_SERVICE_DOES_NOT_EXIST.0 as i32) =>
        {
            None
        }
        Err(err) => return Err(err.into()),
    };

    // A clean STOP does not invoke SCM recovery actions. Wait until the process has really exited
    // before marking the service for deletion, otherwise NSIS can race the still-open executable.
    if let Some(service) = &service {
        stop_if_running(service).context("stop service before uninstall")?;
    }

    // The service intentionally leaves its persistent firewall backstop in place on an ordinary
    // stop. An authorized uninstall is different: remove all machine-level enforcement before
    // deleting the binaries, matching the Linux and macOS uninstall controllers.
    let mut state = talysman::state::PersistentState::load();
    state.focus_active = false;
    state.focus_source = talysman::model::FocusSource::User;
    state
        .save()
        .context("persist focus-off state before uninstall")?;
    talysman::enforce::teardown_network();
    talysman::enforce::extension_policy::uninstall();

    let Some(service) = service else {
        println!("Service '{SERVICE_NAME}' was already removed.");
        return Ok(());
    };
    service.delete().context("mark service for deletion")?;
    drop(service);

    // DeleteService is asynchronous with respect to the SCM database. Verify the registration is
    // actually gone so a later reinstall cannot fail with ERROR_SERVICE_MARKED_FOR_DELETE.
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        match manager.open_service(SERVICE_NAME, ServiceAccess::QUERY_STATUS) {
            Err(windows_service::Error::Winapi(err))
                if err.raw_os_error() == Some(ERROR_SERVICE_DOES_NOT_EXIST.0 as i32) =>
            {
                break
            }
            _ if Instant::now() >= deadline => {
                anyhow::bail!(
                    "service is still pending deletion after 15 seconds; close the Services console and retry"
                )
            }
            _ => std::thread::sleep(Duration::from_millis(250)),
        }
    }

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

/// Exit 10 if focus is active AND no paired key is present (so the NSIS uninstaller can abort).
/// If the service can't be reached, allow uninstall (exit 0). A connected but unresponsive
/// service fails closed after five seconds instead of hanging the uninstaller indefinitely.
async fn query_uninstall_guard() -> Result<()> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::windows::named_pipe::ClientOptions;

    let path = pipe_path(PIPE_BASE_PROD);
    let client = match ClientOptions::new().open(&path) {
        Ok(client) => client,
        Err(_) => return Ok(()), // service not running → nothing to guard
    };
    let (reader, mut writer) = tokio::io::split(client);

    writer
        .write_all(b"{\"kind\":\"request\",\"id\":1,\"method\":\"getState\",\"params\":{}}\n")
        .await?;

    let mut lines = BufReader::new(reader).lines();
    while let Some(line) = lines.next_line().await? {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
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
    }
    anyhow::bail!("service closed the uninstall safety check without responding")
}

fn guard_uninstall() -> Result<()> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .context("create uninstall safety-check runtime")?;
    runtime.block_on(async {
        tokio::time::timeout(Duration::from_secs(5), query_uninstall_guard())
            .await
            .context("service timed out during uninstall safety check")?
    })
}

fn main() {
    let cmd = std::env::args().nth(1).unwrap_or_else(|| "help".into());
    let result = match cmd.as_str() {
        "install" => install(),
        "uninstall" => uninstall(),
        "start" => start(),
        "stop" => stop(),
        "status" => status(),
        "guard-uninstall" => guard_uninstall(),
        _ => {
            eprintln!(
                "usage: talysman-svcctl <install|uninstall|start|stop|status|guard-uninstall>"
            );
            std::process::exit(2);
        }
    };
    if let Err(e) = result {
        eprintln!("error: {e:#}");
        std::process::exit(1);
    }
}
