//! talysman-svcctl for Linux. Installs/removes the systemd service.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use anyhow::{bail, Context, Result};

use talysman::constants::{socket_path, PIPE_BASE_PROD, SERVICE_DISPLAY_NAME, SERVICE_NAME};
use talysman::enforce::dns;
use talysman::paths;

const UNIT_PATH: &str = "/etc/systemd/system/talysman.service";

fn svc_exe_path() -> Result<PathBuf> {
    let dir = std::env::current_exe()?
        .parent()
        .context("no parent dir for current exe")?
        .to_path_buf();
    Ok(dir.join("talysman-svc"))
}

fn unit_text() -> Result<String> {
    let exe = svc_exe_path()?;
    Ok(format!(
        r#"[Unit]
Description={SERVICE_DISPLAY_NAME}
After=network-online.target nftables.service
Wants=network-online.target

[Service]
Type=simple
ExecStart={}
Restart=always
RestartSec=1
RuntimeDirectory=talysman
RuntimeDirectoryMode=0755
StateDirectory=talysman
StateDirectoryMode=0750

[Install]
WantedBy=multi-user.target
"#,
        exe.display()
    ))
}

fn run(program: &str, args: &[&str]) -> Result<()> {
    let out = Command::new(program).args(args).output()?;
    if out.status.success() {
        return Ok(());
    }
    bail!(
        "{} {} failed: {}",
        program,
        args.join(" "),
        String::from_utf8_lossy(&out.stderr).trim()
    )
}

fn install() -> Result<()> {
    let service_already_installed = std::path::Path::new(UNIT_PATH).exists();
    paths::ensure_data_dir().context("create Talysman data dir")?;
    dns::install_include().context("write dnsmasq include")?;
    talysman::enforce::extension_policy::install();
    std::fs::write(UNIT_PATH, unit_text()?).context("write systemd unit")?;
    run("systemctl", &["daemon-reload"])?;
    // Installation is also the package upgrade path; restart an existing daemon so it begins
    // executing the newly installed binary.
    if service_already_installed {
        run("systemctl", &["enable", SERVICE_NAME])?;
        run("systemctl", &["restart", SERVICE_NAME])?;
    } else {
        run("systemctl", &["enable", "--now", SERVICE_NAME])?;
    }
    println!("Service '{SERVICE_NAME}' installed and started.");
    Ok(())
}

fn uninstall() -> Result<()> {
    let _ = guard_uninstall();
    let _ = run("systemctl", &["disable", "--now", SERVICE_NAME]);
    let _ = std::fs::remove_file(UNIT_PATH);
    let _ = run("systemctl", &["daemon-reload"]);
    talysman::enforce::extension_policy::uninstall();
    talysman::enforce::teardown_network();
    dns::remove_include();
    println!("Service '{SERVICE_NAME}' removed.");
    Ok(())
}

fn start() -> Result<()> {
    run("systemctl", &["start", SERVICE_NAME])?;
    println!("started");
    Ok(())
}

fn stop() -> Result<()> {
    run("systemctl", &["stop", SERVICE_NAME])?;
    println!("stop signalled");
    Ok(())
}

fn status() -> Result<()> {
    run("systemctl", &["status", "--no-pager", SERVICE_NAME])
}

fn guard_uninstall() -> Result<()> {
    let path = socket_path(PIPE_BASE_PROD);
    let mut stream = match UnixStream::connect(&path) {
        Ok(s) => s,
        Err(_) => return Ok(()),
    };
    // A connected-but-unresponsive service must not hang the uninstaller (and, transitively,
    // `dpkg -r`/`apt remove`) indefinitely; fail closed after 5 seconds instead. Matches the
    // Windows guard's timeout (native/windows/src/bin/svcctl.rs, query_uninstall_guard).
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .context("set uninstall safety-check timeout")?;
    stream.write_all(b"{\"kind\":\"request\",\"id\":1,\"method\":\"getState\",\"params\":{}}\n")?;
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    loop {
        match reader.read_line(&mut line) {
            Ok(0) => return Ok(()),
            Ok(_) => {
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
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                bail!("service did not respond to the uninstall safety check within 5 seconds");
            }
            Err(e) => return Err(e.into()),
        }
    }
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
