//! focuslock-svcctl for Linux. Installs/removes the systemd service and manages recovery codes.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::Command;

use anyhow::{bail, Context, Result};

use focuslock::constants::{socket_path, PIPE_BASE_PROD, SERVICE_DISPLAY_NAME, SERVICE_NAME};
use focuslock::enforce::dns;
use focuslock::pairing;
use focuslock::paths;
use focuslock::secure_store::SecureStore;

const UNIT_PATH: &str = "/etc/systemd/system/focuslock.service";

fn svc_exe_path() -> Result<PathBuf> {
    let dir = std::env::current_exe()?
        .parent()
        .context("no parent dir for current exe")?
        .to_path_buf();
    Ok(dir.join("focuslock-svc"))
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
RuntimeDirectory=focuslock
RuntimeDirectoryMode=0755
StateDirectory=focuslock
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
    paths::ensure_data_dir().context("create FocusLock data dir")?;
    dns::install_include().context("write dnsmasq include")?;
    std::fs::write(UNIT_PATH, unit_text()?).context("write systemd unit")?;
    run("systemctl", &["daemon-reload"])?;
    run("systemctl", &["enable", "--now", SERVICE_NAME])?;
    gen_code()?;
    println!("Service '{SERVICE_NAME}' installed and started.");
    Ok(())
}

fn uninstall() -> Result<()> {
    let _ = guard_uninstall();
    let _ = run("systemctl", &["disable", "--now", SERVICE_NAME]);
    let _ = std::fs::remove_file(UNIT_PATH);
    let _ = run("systemctl", &["daemon-reload"]);
    focuslock::enforce::teardown_network();
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

fn gen_code() -> Result<()> {
    let code = pairing::generate_recovery_code();
    let mut store = SecureStore::load();
    store.recovery = Some(pairing::hash_recovery_code(&code));
    store.save().context("save secure store")?;

    let path = paths::recovery_code_file();
    let _ = std::fs::write(&path, format!("FocusLock recovery code: {code}\n"));

    println!("\n==================== FocusLock RECOVERY CODE ====================");
    println!("  {code}");
    println!("  Save this somewhere safe. If you ever get locked out and can't");
    println!("  use your USB key, run: focuslock-recover --code {code}");
    println!("  (also written to {})", path.display());
    println!("================================================================\n");
    Ok(())
}

fn guard_uninstall() -> Result<()> {
    let path = socket_path(PIPE_BASE_PROD);
    let mut stream = match UnixStream::connect(&path) {
        Ok(s) => s,
        Err(_) => return Ok(()),
    };
    stream.write_all(b"{\"kind\":\"request\",\"id\":1,\"method\":\"getState\",\"params\":{}}\n")?;
    let mut reader = BufReader::new(stream);
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
                "usage: focuslock-svcctl <install|uninstall|start|stop|status|gen-code|guard-uninstall>"
            );
            std::process::exit(2);
        }
    };
    if let Err(e) = result {
        eprintln!("error: {e:#}");
        std::process::exit(1);
    }
}
