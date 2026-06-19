//! `focus-disable` — turn FocusLock blocking off (requires the paired USB key).

fn main() -> std::process::ExitCode {
    focuslock::focus_cli::run(false)
}
