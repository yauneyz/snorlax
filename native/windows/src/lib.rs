//! FocusLock shared library: the modules used by all three binaries (service, svcctl,
//! recover). See snorlax-architecture.md §4–§9 for the design.
//!
//! Enforcement note (v1 pragmatic subset, per the approved plan): website blocking is done by
//! a WinDivert packet engine (enforce::divert) that intercepts outbound DNS and answers
//! NXDOMAIN for blocked names + DoH endpoint hostnames + the Firefox canary (policy_match),
//! drops DNS-over-TLS/QUIC, and resets live browser TCP flows on a toggle/policy change so
//! blocks take effect immediately. Persistent Windows-Firewall rules blocking DoT/DoQ and 443
//! to known DoH resolver IPs (enforce::wfp) are the backstop that survives a service kill. App
//! blocking is process-termination (enforce::apps). The dns module is now just the pure DNS
//! wire helpers the engine reuses. A kernel-WFP connect-redirect callout (true persistence +
//! closing the hardcoded-resolver-IP gap) and raw FWPM whitelist/block-all filters are the
//! documented hardening upgrades and are intentionally not in v1.

pub mod constants;
pub mod core;
pub mod enforce;
pub mod ipc;
pub mod model;
pub mod pairing;
pub mod paths;
pub mod policy_match;
pub mod run;
pub mod schedule;
pub mod secure_store;
pub mod service;
pub mod state;
pub mod usb;

pub use constants::*;
