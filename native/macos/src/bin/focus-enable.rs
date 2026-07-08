//! `focus-enable` — turn Talysman blocking on.

fn main() -> std::process::ExitCode {
    talysman::focus_cli::run(true)
}
