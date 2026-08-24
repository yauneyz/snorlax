//! `focus-toggle` — atomically toggle Talysman blocking.
//!
//! Turning focus on is always allowed once a key has been paired. Turning it off requires the
//! paired USB key to be inserted, exactly like `focus-disable`.

fn main() -> std::process::ExitCode {
    talysman::focus_cli::run_toggle()
}
