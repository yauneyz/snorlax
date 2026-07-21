//! talysman-svcctl for macOS. Installs/removes the LaunchDaemon and manages recovery codes.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::Command;

use anyhow::{bail, Context, Result};

use talysman::constants::{socket_path, PIPE_BASE_PROD, SERVICE_NAME};
use talysman::launchd;
use talysman::pairing;
use talysman::paths;
use talysman::secure_store::SecureStore;

fn svc_exe_path() -> Result<PathBuf> {
    let dir = std::env::current_exe()?
        .parent()
        .context("no parent dir for current exe")?
        .to_path_buf();
    Ok(dir.join("talysman-svc"))
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
    paths::ensure_data_dir().context("create Talysman data dir")?;
    talysman::enforce::extension_policy::install();
    let exe = svc_exe_path()?;
    std::fs::write(
        launchd::plist_path(),
        launchd::plist_text(&exe.to_string_lossy()),
    )
    .context("write LaunchDaemon plist")?;
    // Installation is also the repair/upgrade path. Preserve the original killswitch while
    // replacing/restarting the daemon from the newly installed application bundle.
    ensure_recovery_code()?;
    // Reload cleanly if a previous copy is loaded; "not loaded" is fine.
    launchd::bootout();
    if !launchd::bootstrap().context("launchctl bootstrap")? {
        bail!("launchctl could not load {}", launchd::PLIST_PATH);
    }
    println!("Service '{SERVICE_NAME}' installed and started.");
    Ok(())
}

fn uninstall() -> Result<()> {
    let _ = guard_uninstall();
    launchd::bootout();
    let _ = std::fs::remove_file(launchd::plist_path());
    talysman::enforce::extension_policy::uninstall();
    talysman::enforce::teardown_network();
    println!("Service '{SERVICE_NAME}' removed.");
    Ok(())
}

fn start() -> Result<()> {
    if !launchd::bootstrap()? {
        bail!("launchctl could not load {}", launchd::PLIST_PATH);
    }
    println!("started");
    Ok(())
}

fn stop() -> Result<()> {
    launchd::bootout();
    println!("stop signalled");
    Ok(())
}

fn status() -> Result<()> {
    run(
        "launchctl",
        &["print", &format!("system/{}", launchd::LABEL)],
    )
}

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
    println!("  use your USB key, run: talysman-recover --code {code}");
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
