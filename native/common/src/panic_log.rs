//! Panic logging for the privileged services.
//!
//! Without this, a panic anywhere off the main thread is silent. That matters more here than in a
//! normal program: enforcement runs on dedicated OS threads (the packet engines and the resolver)
//! and on spawned tokio tasks, and Rust's default behaviour is to unwind *that thread only* and
//! leave the process running. Blocking would simply stop while the service kept reporting healthy
//! and the log stayed empty — a fail-open with no evidence.
//!
//! The hook logs at error level, which is the only level these services write to disk, and then
//! defers to the previous hook so nothing that already depended on it changes.

use std::sync::Once;

static INSTALLED: Once = Once::new();

/// Install the process-wide panic hook. Idempotent; safe to call from every entry point.
pub fn install() {
    INSTALLED.call_once(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            // `panic::Location` is far more useful than the message alone when the payload is a
            // bare `unwrap()`, which is most of them.
            let location = info
                .location()
                .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
                .unwrap_or_else(|| "<unknown location>".to_string());

            let payload = info.payload();
            let message = payload
                .downcast_ref::<&str>()
                .map(|s| (*s).to_string())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "<non-string panic payload>".to_string());

            let thread = std::thread::current();
            let thread_name = thread.name().unwrap_or("<unnamed>").to_string();

            tracing::error!(
                "PANIC on thread '{thread_name}' at {location}: {message} — this thread has died; \
                 if it was an enforcement thread, blocking has silently stopped and the service \
                 must be restarted."
            );

            previous(info);
        }));
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The hook runs inside the panic machinery, where a panic of its own would abort the process.
    /// Exercise the payload downcast for both payload shapes it can receive.
    #[test]
    fn hook_survives_both_payload_shapes() {
        install();
        install(); // idempotent

        let str_panic = std::panic::catch_unwind(|| panic!("a &str payload"));
        assert!(str_panic.is_err());

        let string_panic =
            std::panic::catch_unwind(|| panic!("{}", String::from("a String payload")));
        assert!(string_panic.is_err());

        // A non-string payload takes the fallback branch rather than the downcasts.
        let odd_panic = std::panic::catch_unwind(|| std::panic::panic_any(42u8));
        assert!(odd_panic.is_err());
    }
}
