//! `talysman_common` — OS-agnostic logic shared by every native backend (Windows, Linux, and the
//! future macOS daemon). Each backend supplies the system-level pieces (process enumeration, window
//! close, process kill); this crate owns the **decisions** so they live in exactly one place and are
//! unit-tested without touching the OS.
//!
//! Today this is the browser handshake "dead-man's switch": the browser classification table
//! ([`browsers`]) and the escalation state machine ([`watchdog`]).

pub mod browsers;
pub mod watchdog;

/// Browser-store and sideload identities generated from `extension-identities.json`.
pub mod extension_identity {
    include!(concat!(env!("OUT_DIR"), "/extension_identity.rs"));
}
