//! Enforcement orchestration (architecture §4.1). Website blocking follows the Linux sibling
//! `focusd`: a destination IP is dropped purely because it is in the **blocked-IP set**, which is
//! built by resolving the policy's expanded domains ourselves (enforce::resolve) and refreshed on a
//! ticker. There is no per-connection inspection, no SNI inspection, and no per-IP allow hole:
//! a pooled/coalesced/opaque socket to a blocked IP simply cannot send while focus is active.
//!
//! The resolver runs whether focus is on or off, so the IP bank stays warm. Focus toggles only gate
//! packet enforcement; they do not clear the resolved IP sets.
//!
//! Backed by persistent Windows-Firewall DoT/DoH-IP/QUIC rules (enforce::wfp) and the
//! force-installed browser extension (enforce::extension_policy); app blocking is process
//! termination (enforce::apps).

pub mod apps;
pub mod divert;
pub mod dns;
pub mod extension_policy;
pub mod properties;
pub mod resolve;
pub mod wfp;

use std::collections::HashSet;
use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use crate::model::{Mode, Policy};
use crate::policy_match::is_host_blocked;

/// Cap on the resolved blocked/allowed sets. Each member becomes a clause in a WinDivert filter
/// string, so this bounds the filter length. Resolver sets are replaced wholesale (focusd-style)
/// and refreshed continuously, so the cap is a hard sanity ceiling.
const MAX_FILTER_IPS: usize = 400;

/// State shared between the always-running enforcement threads (DNS sinkhole engine, IP-drop
/// manager, resolver ticker) and the core dispatcher. Policy/focus changes take effect live, and
/// the resolver feeds the IP sets that drive the drop filter.
pub struct EnforceShared {
    pub policy: Mutex<Policy>,
    pub focus_active: AtomicBool,
    /// Destinations to drop while focused (blacklist): the IPs the policy's **blocked** domains
    /// currently resolve to. Replaced wholesale on every resolver pass — focusd's atomic IP-set
    /// swap, which is how a rotated-away CDN IP stops being blocked.
    blocked: Mutex<HashSet<IpAddr>>,
    /// Allowed destinations (whitelist): the IPs the policy's **allowed** domains resolve to. The
    /// whitelist drop filter drops all web egress *except* these. Replaced wholesale per resolver
    /// pass, same as `blocked`.
    allowed: Mutex<HashSet<IpAddr>>,
    /// Bumped on every drop-set membership change; the IP-drop manager polls it to know when to
    /// rebuild its filter.
    gen: AtomicU64,
}

impl EnforceShared {
    pub fn new(policy: Policy, focus_active: bool) -> Self {
        EnforceShared {
            policy: Mutex::new(Self::effective(policy)),
            focus_active: AtomicBool::new(focus_active),
            blocked: Mutex::new(HashSet::new()),
            allowed: Mutex::new(HashSet::new()),
            gen: AtomicU64::new(0),
        }
    }

    /// Turn an authored policy into the form the service enforces: domains expanded with the
    /// siblings of any known multi-domain property (properties::expand_domains). The authored
    /// policy stays the user's clean input in PersistentState; only this enforced copy is expanded.
    fn effective(mut policy: Policy) -> Policy {
        policy.domains = crate::enforce::properties::expand_domains(&policy.domains);
        policy
    }

    pub fn is_active(&self) -> bool {
        self.focus_active.load(Ordering::SeqCst)
    }

    pub fn set_active(&self, active: bool) {
        self.focus_active.store(active, Ordering::SeqCst);
    }

    pub fn policy_snapshot(&self) -> Policy {
        self.policy.lock().unwrap().clone()
    }

    /// The enforced policy's mode (drives the drop-filter polarity).
    pub fn mode(&self) -> Mode {
        self.policy.lock().unwrap().mode.clone()
    }

    pub fn set_policy(&self, policy: Policy) {
        *self.policy.lock().unwrap() = Self::effective(policy);
    }

    /// Replace the resolved **blocked** IP set wholesale (focusd's atomic swap). Called by the
    /// resolver after each pass over the policy's blocked domains. Bumps the generation if the set
    /// changed so the IP-drop manager rebuilds its filter.
    pub fn set_blocked_ips(&self, ips: HashSet<IpAddr>) {
        let mut ips = ips;
        Self::cap(&mut ips);
        let mut guard = self.blocked.lock().unwrap();
        if *guard != ips {
            *guard = ips;
            self.gen.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// Replace the resolved **allowed** IP set wholesale (whitelist mode). Same swap semantics as
    /// `set_blocked_ips`.
    pub fn set_allowed_ips(&self, ips: HashSet<IpAddr>) {
        let mut ips = ips;
        Self::cap(&mut ips);
        let mut guard = self.allowed.lock().unwrap();
        if *guard != ips {
            *guard = ips;
            self.gen.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// The current blocked-set IPs, sorted (stable filter strings). Blacklist drop targets.
    pub fn blocked_ips(&self) -> Vec<IpAddr> {
        let mut ips: Vec<IpAddr> = self.blocked.lock().unwrap().iter().copied().collect();
        ips.sort();
        ips
    }

    /// The current allowed-set IPs, sorted (stable filter strings). Whitelist allow targets.
    pub fn allowed_ips(&self) -> Vec<IpAddr> {
        let mut ips: Vec<IpAddr> = self.allowed.lock().unwrap().iter().copied().collect();
        ips.sort();
        ips
    }

    /// Ingest one resolved `host → ip` from the resolver into the per-pass accumulator the
    /// caller will hand to `set_blocked_ips` / `set_allowed_ips`. Returns whether the IP belongs in
    /// the blocked set (blacklist) or the allowed set (whitelist); block-all resolves nothing.
    pub fn classify_resolved(&self, host: &str) -> ResolvedClass {
        let policy = self.policy_snapshot();
        match policy.mode {
            Mode::Blacklist if is_host_blocked(&policy, host) => ResolvedClass::Blocked,
            Mode::Whitelist if !is_host_blocked(&policy, host) => ResolvedClass::Allowed,
            _ => ResolvedClass::Ignore,
        }
    }

    /// The hosts the resolver should look up for the current policy: the blocked (expanded) domains
    /// in blacklist mode, the allowed domains in whitelist mode, none in block-all.
    pub fn resolver_targets(&self) -> Vec<String> {
        let policy = self.policy_snapshot();
        match policy.mode {
            Mode::Blacklist | Mode::Whitelist => policy.domains.clone(),
            Mode::BlockAll => Vec::new(),
        }
    }

    /// Monotonic counter of drop-set membership changes (poll-and-compare by the IP-drop manager).
    pub fn generation(&self) -> u64 {
        self.gen.load(Ordering::SeqCst)
    }

    fn cap(ips: &mut HashSet<IpAddr>) {
        while ips.len() > MAX_FILTER_IPS {
            if let Some(&victim) = ips.iter().next() {
                ips.remove(&victim);
            } else {
                break;
            }
        }
    }
}

/// How the resolver should file a resolved host's IP.
#[derive(Debug, PartialEq, Eq)]
pub enum ResolvedClass {
    Blocked,
    Allowed,
    Ignore,
}

/// Ensure the persistent firewall backstop is in force (focus on) or removed (focus off). The
/// DNS sinkhole engine + IP-drop manager run for the whole service lifetime and self-gate on
/// `focus_active`; only these persistent rules need explicit set-up/tear-down, and they survive a
/// service kill (unlike the WinDivert layer).
pub fn apply_network(active: bool) {
    if active {
        wfp::block_dns_over_tls();
        wfp::block_doh_resolvers();
        wfp::block_quic();
    } else {
        teardown_network();
    }
}

/// Remove all focus-toggled machine-level network changes (focus-off and the killswitch).
pub fn teardown_network() {
    wfp::clear_rules();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    fn shared() -> EnforceShared {
        EnforceShared::new(Policy::default(), false)
    }

    fn ip(n: u8) -> IpAddr {
        Ipv4Addr::new(10, 0, 0, n).into()
    }

    fn set(ns: &[u8]) -> HashSet<IpAddr> {
        ns.iter().map(|n| ip(*n)).collect()
    }

    #[test]
    fn set_blocked_replaces_wholesale_and_bumps_generation() {
        let s = shared();
        let g0 = s.generation();
        s.set_blocked_ips(set(&[1, 2]));
        let g1 = s.generation();
        assert!(g1 > g0, "new set must bump generation");
        assert_eq!(s.blocked_ips(), vec![ip(1), ip(2)]);
        // Identical set: no bump.
        s.set_blocked_ips(set(&[1, 2]));
        assert_eq!(s.generation(), g1);
        // Wholesale replace: ip(1) drops out, ip(3) appears (focusd atomic swap).
        s.set_blocked_ips(set(&[2, 3]));
        assert!(s.generation() > g1);
        assert_eq!(s.blocked_ips(), vec![ip(2), ip(3)]);
    }

    #[test]
    fn classify_resolved_by_mode() {
        let s = EnforceShared::new(
            Policy {
                mode: Mode::Blacklist,
                domains: vec!["reddit.com".into()],
                apps: Vec::new(),
            },
            true,
        );
        assert_eq!(s.classify_resolved("reddit.com"), ResolvedClass::Blocked);
        assert_eq!(s.classify_resolved("example.com"), ResolvedClass::Ignore);

        s.set_policy(Policy {
            mode: Mode::Whitelist,
            domains: vec!["gmail.com".into()],
            apps: Vec::new(),
        });
        assert_eq!(s.classify_resolved("gmail.com"), ResolvedClass::Allowed);
        assert_eq!(s.classify_resolved("youtube.com"), ResolvedClass::Ignore);
    }

    #[test]
    fn allowed_ips_are_resolver_only() {
        let s = shared();
        s.set_allowed_ips(set(&[2]));
        assert_eq!(s.allowed_ips(), vec![ip(2)]);
    }

    #[test]
    fn effective_policy_expands_property_siblings() {
        let s = EnforceShared::new(
            Policy {
                mode: Mode::Blacklist,
                domains: vec!["x.com".into()],
                apps: Vec::new(),
            },
            false,
        );
        let targets = s.resolver_targets();
        assert!(targets.contains(&"x.com".to_string()));
        assert!(targets.contains(&"twimg.com".to_string()));
        assert!(targets.contains(&"twitter.com".to_string()));
        assert!(targets.contains(&"t.co".to_string()));
    }
}
