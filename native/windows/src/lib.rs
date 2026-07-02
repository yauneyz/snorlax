//! Talysman shared library: the modules used by all three binaries (service, svcctl,
//! recover). See snorlax-architecture.md §4–§9 for the design.
//!
//! Enforcement note (focusd-style IP blocking): website blocking is a stateless destination-IP
//! drop, following the Linux sibling `focusd`. The resolver (enforce::resolve) continuously
//! resolves the policy's expanded domains to their current IPs, even while focus is off; a
//! WinDivert DROP handle (enforce::divert) then discards every outbound packet to that set while
//! focused, on every socket, with no per-connection inspection or SNI. The resolver refreshes the
//! set on a ticker (CDN rotation), replacing it wholesale. The DNS engine still answers NXDOMAIN
//! for blocked names + DoH endpoints + the Firefox canary (policy_match) and drops
//! DNS-over-TLS/QUIC. The IP-coarse model can over-block CDN IPs shared with an allowed tenant; the
//! browser extension (enforce::extension_policy) is the request-layer blocker for browser traffic,
//! but it does not create network-layer IP exemptions. Persistent Windows-Firewall rules blocking
//! DoT/DoQ, QUIC, and 443 to known DoH resolver IPs (enforce::wfp) are the backstop that survives a
//! service kill. App blocking is process-termination (enforce::apps). A kernel-WFP
//! connect-redirect callout is the documented hardening upgrade and is intentionally not in v1.

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
