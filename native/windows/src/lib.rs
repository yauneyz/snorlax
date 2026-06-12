//! FocusLock shared library: the modules used by all three binaries (service, svcctl,
//! recover). See snorlax-architecture.md §4–§9 for the design.
//!
//! Enforcement note (v1 pragmatic subset, per the approved plan): website blocking is done by
//! a loopback DNS sinkhole + pointing every adapter's DNS at it (enforce::dns), plus a
//! Windows-Firewall (WFP-backed) rule blocking DNS-over-TLS (enforce::wfp). App blocking is
//! process-termination (enforce::apps). Raw FWPM permit/block filters with weight-based
//! permit-exceptions, whitelist/block-all network filters, and the DoH IP list are the
//! documented hardening upgrades and are intentionally not in v1.

pub mod constants;
pub mod core;
pub mod enforce;
pub mod ipc;
pub mod model;
pub mod paths;
pub mod pairing;
pub mod policy_match;
pub mod run;
pub mod schedule;
pub mod secure_store;
pub mod service;
pub mod state;
pub mod usb;

pub use constants::*;
