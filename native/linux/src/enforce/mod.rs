//! Linux enforcement orchestration.
//!
//! The core website blocker follows focusd's durable model: resolve policy domains through our own
//! upstream DNS client, keep a warm IP bank, and install nftables output-hook drops from those IP
//! sets while focus is active.

pub mod apps;
pub mod dns;
pub mod extension_policy;
pub mod nft;
pub mod properties;
pub mod resolve;

use std::collections::HashSet;
use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use crate::model::{Mode, Policy};
use crate::policy_match::is_host_blocked;

const MAX_FILTER_IPS: usize = 4000;

pub struct EnforceShared {
    pub policy: Mutex<Policy>,
    pub focus_active: AtomicBool,
    blocked: Mutex<HashSet<IpAddr>>,
    allowed: Mutex<HashSet<IpAddr>>,
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

    fn effective(mut policy: Policy) -> Policy {
        policy.domains = crate::enforce::properties::expand_domains(&policy.domains);
        policy
    }

    pub fn is_active(&self) -> bool {
        self.focus_active.load(Ordering::SeqCst)
    }

    pub fn set_active(&self, active: bool) {
        self.focus_active.store(active, Ordering::SeqCst);
        self.gen.fetch_add(1, Ordering::SeqCst);
    }

    pub fn policy_snapshot(&self) -> Policy {
        self.policy.lock().unwrap().clone()
    }

    pub fn mode(&self) -> Mode {
        self.policy.lock().unwrap().mode.clone()
    }

    pub fn set_policy(&self, policy: Policy) {
        *self.policy.lock().unwrap() = Self::effective(policy);
        self.gen.fetch_add(1, Ordering::SeqCst);
    }

    pub fn set_blocked_ips(&self, ips: HashSet<IpAddr>) {
        let mut ips = ips;
        Self::cap(&mut ips);
        let mut guard = self.blocked.lock().unwrap();
        if *guard != ips {
            *guard = ips;
            self.gen.fetch_add(1, Ordering::SeqCst);
        }
    }

    pub fn set_allowed_ips(&self, ips: HashSet<IpAddr>) {
        let mut ips = ips;
        Self::cap(&mut ips);
        let mut guard = self.allowed.lock().unwrap();
        if *guard != ips {
            *guard = ips;
            self.gen.fetch_add(1, Ordering::SeqCst);
        }
    }

    pub fn blocked_ips(&self) -> Vec<IpAddr> {
        let mut ips: Vec<IpAddr> = self.blocked.lock().unwrap().iter().copied().collect();
        ips.sort();
        ips
    }

    pub fn allowed_ips(&self) -> Vec<IpAddr> {
        let mut ips: Vec<IpAddr> = self.allowed.lock().unwrap().iter().copied().collect();
        ips.sort();
        ips
    }

    pub fn classify_resolved(&self, host: &str) -> ResolvedClass {
        let policy = self.policy_snapshot();
        match policy.mode {
            Mode::Blacklist if is_host_blocked(&policy, host) => ResolvedClass::Blocked,
            Mode::Whitelist if !is_host_blocked(&policy, host) => ResolvedClass::Allowed,
            _ => ResolvedClass::Ignore,
        }
    }

    pub fn resolver_targets(&self) -> Vec<String> {
        let policy = self.policy_snapshot();
        match policy.mode {
            Mode::Blacklist | Mode::Whitelist => policy.domains.clone(),
            Mode::BlockAll => Vec::new(),
        }
    }

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

#[derive(Debug, PartialEq, Eq)]
pub enum ResolvedClass {
    Blocked,
    Allowed,
    Ignore,
}

pub fn apply_network(active: bool) {
    if !active {
        teardown_network();
    }
}

pub fn teardown_network() {
    if let Err(e) = dns::remove_config() {
        tracing::warn!("failed to remove dnsmasq sinkhole config: {e}");
    }
    nft::remove_rules();
}
