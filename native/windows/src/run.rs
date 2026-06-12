//! Small helper for shelling out to Windows tools (netsh / powershell / sc). Centralised so
//! enforcement actions log consistently and never panic the service on a failed command —
//! e.g. when running in dev console mode without administrator rights.

use std::process::Command;

/// Run a command, logging the outcome. Returns true on a zero exit code. Never panics.
pub fn run_command(program: &str, args: &[&str], what: &str) -> bool {
    match Command::new(program).args(args).output() {
        Ok(out) if out.status.success() => {
            tracing::info!("{what}: ok");
            true
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            tracing::warn!("{what}: exit {:?}: {}", out.status.code(), stderr.trim());
            false
        }
        Err(e) => {
            tracing::warn!("{what}: failed to spawn {program}: {e}");
            false
        }
    }
}
