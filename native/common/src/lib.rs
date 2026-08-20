//! `talysman_common` — OS-agnostic logic shared by every native backend (Windows, Linux, and the
//! future macOS daemon). Each backend supplies the system-level pieces (process enumeration, window
//! close, process kill); this crate owns the **decisions** so they live in exactly one place and are
//! unit-tested without touching the OS.
//!
//! Today this covers the browser handshake "dead-man's switch" — the browser classification table
//! ([`browsers`]) and the escalation state machine ([`watchdog`]) — and the [`policy`] data model
//! that every backend must accept and emit identically.

pub mod browsers;
pub mod extension_compat;
pub mod model;
pub mod pairing;
pub mod panic_log;
pub mod policy;
pub mod policy_match;
pub mod watchdog;

/// Browser-store and sideload identities generated from `extension-identities.json`.
pub mod extension_identity {
    include!(concat!(env!("OUT_DIR"), "/extension_identity.rs"));
}
