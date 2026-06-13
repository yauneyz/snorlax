//! FocusLock shared library: the modules used by all three binaries (service, svcctl,
//! recover). See snorlax-architecture.md §4–§9 for the design.
//!
//! Enforcement note (IP-first, guilty-until-proven-innocent): website blocking is done by a set
//! of WinDivert packet engines (enforce::divert). A destination IP associated with a blocked
//! domain is dropped by default — the suspect set is **pre-armed at focus-on** from the persisted
//! antibody store (enforce::observations), the active resolver (enforce::resolve), and the
//! recorded flows — so a pooled/coalesced/opaque socket dies instantly. The SNI engine
//! *exonerates* a new connection that proves an allowed hostname on the wire (it only drops 443
//! application-data, letting handshakes through to be judged). The DNS engine still answers
//! NXDOMAIN for blocked names + DoH endpoints + the Firefox canary (policy_match) and drops
//! DNS-over-TLS/QUIC. Persistent Windows-Firewall rules blocking DoT/DoQ and 443 to known DoH
//! resolver IPs (enforce::wfp) are the backstop that survives a service kill; managed browser
//! policies (enforce::browser_policy) cover the request layer. App blocking is process-termination
//! (enforce::apps). A kernel-WFP connect-redirect callout (true persistence + closing the
//! hardcoded-resolver-IP gap) and raw FWPM whitelist/block-all filters are the documented
//! hardening upgrades and are intentionally not in v1.

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
