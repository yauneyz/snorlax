//! `focus-enable` — turn FocusLock blocking on.

fn main() -> std::process::ExitCode {
    focuslock::focus_cli::run(true)
}
