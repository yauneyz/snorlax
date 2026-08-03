//! macOS enforcement orchestration.
//!
//! The core website blocker follows the Linux backend's durable model: resolve policy domains
//! through our own upstream DNS client, keep a warm IP bank, and install pf (packet filter) drops
//! from those IP sets while focus is active. An /etc/hosts managed block is the DNS-level
//! sinkhole (macOS ships no dnsmasq); pf is the packet-level backstop.

pub mod apps;
pub mod browser_watchdog;
pub mod extension_policy;
pub mod hosts;
pub mod pf;
pub mod properties;
pub mod resolve;

use std::collections::{HashMap, HashSet};
use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use talysman_common::watchdog::Heartbeat;

use crate::model::{Mode, Policy};
use crate::policy_match::is_host_blocked;

const MAX_FILTER_IPS: usize = 4000;

#[derive(Default)]
struct ChangeSignal {
    epoch: Mutex<u64>,
    changed: Condvar,
}

impl ChangeSignal {
    fn generation(&self) -> u64 {
        *self.epoch.lock().unwrap()
    }
    fn notify(&self) {
        let mut epoch = self.epoch.lock().unwrap();
        *epoch = epoch.wrapping_add(1);
        self.changed.notify_all();
    }
    fn wait(&self, observed: u64, timeout: Duration) -> u64 {
        let epoch = self.epoch.lock().unwrap();
        if *epoch != observed {
            return *epoch;
        }
        let (epoch, _) = self
            .changed
            .wait_timeout_while(epoch, timeout, |value| *value == observed)
            .unwrap();
        *epoch
    }
}

pub struct EnforceShared {
    pub policy: Mutex<Policy>,
    pub focus_active: AtomicBool,
    blocked: Mutex<HashSet<IpAddr>>,
    allowed: Mutex<HashSet<IpAddr>>,
    gen: AtomicU64,
    /// Browser handshake dead-man's switch on/off (opt-in setting, see model::Settings). The
    /// watchdog only acts while this is true and focus is active.
    handshake_enabled: AtomicBool,
    /// Latest heartbeat per browser process PID, fed by the `extHeartbeat` RPC. The watchdog maps
    /// child-process PIDs to their browser root before evaluating liveness.
    heartbeats: Mutex<HashMap<u32, Heartbeat>>,
    changes: ChangeSignal,
    resolver_changes: ChangeSignal,
    async_changes: tokio::sync::watch::Sender<u64>,
}

impl EnforceShared {
    pub fn new(policy: Policy, focus_active: bool) -> Self {
        let (async_changes, _) = tokio::sync::watch::channel(0);
        EnforceShared {
            policy: Mutex::new(Self::effective(policy)),
            focus_active: AtomicBool::new(focus_active),
            blocked: Mutex::new(HashSet::new()),
            allowed: Mutex::new(HashSet::new()),
            gen: AtomicU64::new(0),
            handshake_enabled: AtomicBool::new(false),
            heartbeats: Mutex::new(HashMap::new()),
            changes: ChangeSignal::default(),
            resolver_changes: ChangeSignal::default(),
            async_changes,
        }
    }

    /// Whether the browser handshake watchdog is enabled.
    pub fn handshake_enabled(&self) -> bool {
        self.handshake_enabled.load(Ordering::SeqCst)
    }

    /// Toggle the watchdog. Clearing it also drops recorded heartbeats so a later re-enable starts
    /// from a clean slate.
    pub fn set_handshake_enabled(&self, enabled: bool) {
        let changed = self.handshake_enabled.swap(enabled, Ordering::SeqCst) != enabled;
        if !enabled {
            self.heartbeats.lock().unwrap().clear();
        }
        if changed {
            self.notify_change();
        }
    }

    /// Record an extension heartbeat for `pid` (the browser instance the extension runs in).
    pub fn record_heartbeat(&self, pid: u32, healthy: bool) -> bool {
        let mut heartbeats = self.heartbeats.lock().unwrap();
        let changed = heartbeats
            .get(&pid)
            .is_none_or(|heartbeat| heartbeat.healthy != healthy);
        heartbeats.insert(
            pid,
            Heartbeat {
                last_seen: Instant::now(),
                healthy,
            },
        );
        changed
    }

    /// A snapshot of all recorded heartbeats, for the watchdog tick.
    pub fn heartbeats_snapshot(&self) -> HashMap<u32, Heartbeat> {
        self.heartbeats.lock().unwrap().clone()
    }

    /// Drop heartbeat entries for PIDs that are no longer running (keeps the map bounded).
    pub fn retain_heartbeats(&self, live: &HashSet<u32>) {
        self.heartbeats
            .lock()
            .unwrap()
            .retain(|pid, _| live.contains(pid));
    }

    fn effective(mut policy: Policy) -> Policy {
        policy.domains = crate::enforce::properties::expand_domains(&policy.domains);
        policy
    }

    pub fn is_active(&self) -> bool {
        self.focus_active.load(Ordering::SeqCst)
    }

    pub fn set_active(&self, active: bool) {
        if self.focus_active.swap(active, Ordering::SeqCst) != active {
            self.gen.fetch_add(1, Ordering::SeqCst);
            self.notify_change();
            if active {
                self.resolver_changes.notify();
            }
        }
    }

    pub fn policy_snapshot(&self) -> Policy {
        self.policy.lock().unwrap().clone()
    }

    pub fn mode(&self) -> Mode {
        self.policy.lock().unwrap().mode.clone()
    }

    pub fn set_policy(&self, policy: Policy) {
        let policy = Self::effective(policy);
        let mut guard = self.policy.lock().unwrap();
        if *guard != policy {
            *guard = policy;
            self.gen.fetch_add(1, Ordering::SeqCst);
            drop(guard);
            self.notify_change();
            self.resolver_changes.notify();
        }
    }

    pub fn set_blocked_ips(&self, ips: HashSet<IpAddr>) {
        let mut ips = ips;
        Self::cap(&mut ips);
        let mut guard = self.blocked.lock().unwrap();
        if *guard != ips {
            *guard = ips;
            self.gen.fetch_add(1, Ordering::SeqCst);
            drop(guard);
            self.notify_change();
        }
    }

    pub fn set_allowed_ips(&self, ips: HashSet<IpAddr>) {
        let mut ips = ips;
        Self::cap(&mut ips);
        let mut guard = self.allowed.lock().unwrap();
        if *guard != ips {
            *guard = ips;
            self.gen.fetch_add(1, Ordering::SeqCst);
            drop(guard);
            self.notify_change();
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

    pub fn change_generation(&self) -> u64 {
        self.changes.generation()
    }
    pub fn wait_for_change(&self, observed: u64, timeout: Duration) -> u64 {
        self.changes.wait(observed, timeout)
    }
    pub fn subscribe_changes(&self) -> tokio::sync::watch::Receiver<u64> {
        self.async_changes.subscribe()
    }
    pub fn resolver_generation(&self) -> u64 {
        self.resolver_changes.generation()
    }
    pub fn wait_for_resolver_change(&self, observed: u64, timeout: Duration) -> u64 {
        self.resolver_changes.wait(observed, timeout)
    }
    pub fn wake_all(&self) {
        self.notify_change();
        self.resolver_changes.notify();
    }
    fn notify_change(&self) {
        self.changes.notify();
        self.async_changes
            .send_modify(|value| *value = value.wrapping_add(1));
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
    if let Err(e) = hosts::remove_config() {
        tracing::warn!("failed to remove /etc/hosts sinkhole block: {e}");
    }
    pf::remove_rules();
}
