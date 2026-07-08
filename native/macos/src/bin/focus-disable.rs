//! `focus-disable` — turn Talysman blocking off (requires the paired USB key).

fn main() -> std::process::ExitCode {
    talysman::focus_cli::run(false)
}
