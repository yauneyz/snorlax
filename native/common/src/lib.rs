//! `talysman_common` — OS-agnostic logic shared by every native backend (Windows, Linux, and the
//! future macOS daemon). Each backend supplies the system-level pieces (process enumeration, window
//! close, process kill); this crate owns the **decisions** so they live in exactly one place and are
//! unit-tested without touching the OS.
//!
//! Profiles, schedules, overrides, pools and streaks live in `talysman_engine`.
//!
//! Today this covers the browser handshake "dead-man's switch" — the browser classification table
//! ([`browsers`]) and the escalation state machine ([`watchdog`]) — and the [`policy`] data model
//! that every backend must accept and emit identically.

pub mod browsers;
pub mod extension_compat;
pub mod model;
pub mod pairing;
pub mod panic_log;
/// The policy model, matching, catalog and premade lists are single-sourced in the platform-free
/// engine (shared with Android and TypeScript); re-exported so `talysman_common::policy` etc. keep
/// working for the daemons.
pub use talysman_engine::{policy, policy_match, premade_lists, site_catalog};
pub mod natmsg_frames;
pub mod natmsg_legacy;
pub mod watchdog;

/// Browser-store and sideload identities generated from `extension-identities.json`.
pub mod extension_identity {
    include!(concat!(env!("OUT_DIR"), "/extension_identity.rs"));
}
