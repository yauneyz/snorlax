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
//! user-installed browser extension (native host registered by enforce::extension_policy); app
//! blocking is process termination (enforce::apps).

pub mod apps;
pub mod browser_watchdog;
pub mod divert;
pub mod dns;
pub mod extension_policy;
pub mod properties;
pub mod resolve;
pub mod wfp;

use std::collections::{HashMap, HashSet};
use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use talysman_common::watchdog::Heartbeat;

use crate::model::{DefaultAction, Policy};
use crate::policy_match::host_matches;

/// Cap on the resolved blocked/allowed sets. Each member becomes a clause in a WinDivert filter
/// string, so this bounds the filter length. Resolver sets are replaced wholesale (focusd-style)
/// and refreshed continuously, so the cap is a hard sanity ceiling.
const MAX_FILTER_IPS: usize = 400;

#[derive(Default)]
struct ChangeSignal {
    epoch: Mutex<u64>,
    changed: Condvar,
}

impl ChangeSignal {
    fn generation(&self) -> u64 {
        *self.epoch.lock().unwrap_or_else(|e| e.into_inner())
    }
    fn notify(&self) {
        let mut epoch = self.epoch.lock().unwrap_or_else(|e| e.into_inner());
        *epoch = epoch.wrapping_add(1);
        self.changed.notify_all();
    }
    fn wait(&self, observed: u64, timeout: Duration) -> u64 {
        let epoch = self.epoch.lock().unwrap_or_else(|e| e.into_inner());
        if *epoch != observed {
            return *epoch;
        }
        let (epoch, _) = self
            .changed
            .wait_timeout_while(epoch, timeout, |value| *value == observed)
            .unwrap_or_else(|e| e.into_inner());
        *epoch
    }
}

/// Locking note: every `Mutex` in this module is taken with
/// `.lock().unwrap_or_else(|e| e.into_inner())` rather than `.lock().unwrap()`. A plain
/// `unwrap` turns one panic into a cascade: `std::sync::Mutex` poisons on panic, so after a
/// single failure *every* later lock of that mutex panics too, and the resolver, the packet
/// engines and the watchdog all fall over in sequence. For a blocker that is a fail-open. The
/// data behind these locks is a policy snapshot and IP/heartbeat sets — recovering the guard
/// and carrying on with a possibly-stale value keeps blocking up, which is the safer outcome.
/// Panics themselves are not swallowed: `talysman_common::panic_log` logs every one.
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
            self.heartbeats.lock().unwrap_or_else(|e| e.into_inner()).clear();
        }
        if changed {
            self.notify_change();
        }
    }

    /// Record an extension heartbeat for `pid` (the browser instance the extension runs in).
    pub fn record_heartbeat(&self, pid: u32, healthy: bool) -> bool {
        let mut heartbeats = self.heartbeats.lock().unwrap_or_else(|e| e.into_inner());
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
        self.heartbeats.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Drop heartbeat entries for PIDs that are no longer running (keeps the map bounded).
    pub fn retain_heartbeats(&self, live: &HashSet<u32>) {
        self.heartbeats
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|pid, _| live.contains(pid));
    }

    /// Turn an authored policy into the form the service enforces: domains expanded with the
    /// siblings of any known multi-domain property (properties::expand_domains). Both hard lists
    /// are expanded — an allow-listed property must cover its siblings too, or a whitelisted site
    /// would half-load. The authored policy stays the user's clean input in PersistentState; only
    /// this enforced copy is expanded.
    fn effective(mut policy: Policy) -> Policy {
        policy.blocked_domains = crate::enforce::properties::expand_domains(&policy.blocked_domains);
        policy.allowed_domains = crate::enforce::properties::expand_domains(&policy.allowed_domains);
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
        self.policy.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// The enforced policy's fallback for anything on neither hard list (drives the drop-filter
    /// polarity: `Allow` builds a block-list filter, `Block` builds an allow-list filter).
    pub fn default_action(&self) -> DefaultAction {
        self.policy.lock().unwrap_or_else(|e| e.into_inner()).default_action
    }

    pub fn set_policy(&self, policy: Policy) {
        let policy = Self::effective(policy);
        let mut guard = self.policy.lock().unwrap_or_else(|e| e.into_inner());
        if *guard != policy {
            *guard = policy;
            self.gen.fetch_add(1, Ordering::SeqCst);
            drop(guard);
            self.notify_change();
            self.resolver_changes.notify();
        }
    }

    /// Replace the resolved **blocked** IP set wholesale (focusd's atomic swap). Called by the
    /// resolver after each pass over the policy's blocked domains. Bumps the generation if the set
    /// changed so the IP-drop manager rebuilds its filter.
    pub fn set_blocked_ips(&self, ips: HashSet<IpAddr>) {
        let mut ips = ips;
        Self::cap(&mut ips);
        let mut guard = self.blocked.lock().unwrap_or_else(|e| e.into_inner());
        if *guard != ips {
            *guard = ips;
            self.gen.fetch_add(1, Ordering::SeqCst);
            drop(guard);
            self.notify_change();
        }
    }

    /// Replace the resolved **allowed** IP set wholesale (whitelist mode). Same swap semantics as
    /// `set_blocked_ips`.
    pub fn set_allowed_ips(&self, ips: HashSet<IpAddr>) {
        let mut ips = ips;
        Self::cap(&mut ips);
        let mut guard = self.allowed.lock().unwrap_or_else(|e| e.into_inner());
        if *guard != ips {
            *guard = ips;
            self.gen.fetch_add(1, Ordering::SeqCst);
            drop(guard);
            self.notify_change();
        }
    }

    /// The current blocked-set IPs, sorted (stable filter strings). Blacklist drop targets.
    pub fn blocked_ips(&self) -> Vec<IpAddr> {
        let mut ips: Vec<IpAddr> = self.blocked.lock().unwrap_or_else(|e| e.into_inner()).iter().copied().collect();
        ips.sort();
        ips
    }

    /// The current allowed-set IPs, sorted (stable filter strings). Whitelist allow targets.
    pub fn allowed_ips(&self) -> Vec<IpAddr> {
        let mut ips: Vec<IpAddr> = self.allowed.lock().unwrap_or_else(|e| e.into_inner()).iter().copied().collect();
        ips.sort();
        ips
    }

    /// Classify a resolved hostname for the IP sets feeding the WinDivert filter: a host on
    /// `blockedDomains` needs its IPs in the drop set, a host on `allowedDomains` needs its IPs in
    /// the exemption set, and anything else is irrelevant here — it is governed by `defaultAction`
    /// directly (no per-IP set is needed for "block/allow everything else").
    pub fn classify_resolved(&self, host: &str) -> ResolvedClass {
        let policy = self.policy_snapshot();
        if policy.blocked_domains.iter().any(|p| host_matches(host, p)) {
            ResolvedClass::Blocked
        } else if policy.allowed_domains.iter().any(|p| host_matches(host, p)) {
            ResolvedClass::Allowed
        } else {
            ResolvedClass::Ignore
        }
    }

    /// Hostnames the resolver needs IPs for: the union of both (expanded) hard lists. Domains
    /// covered only by `defaultAction` need no resolution — the drop filter enforces the default
    /// at the port level.
    pub fn resolver_targets(&self) -> Vec<String> {
        let policy = self.policy_snapshot();
        let mut targets = policy.blocked_domains.clone();
        targets.extend(policy.allowed_domains.iter().cloned());
        targets
    }

    /// Monotonic counter of drop-set membership changes (poll-and-compare by the IP-drop manager).
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

/// Remove all focus-toggled machine-level network changes (focus-off or authorized uninstall).
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

    /// Classification keys off which hard list a host is on, not off a mode: blocked domains feed
    /// the drop set, allowed domains the exemption set, and everything else is left to
    /// `defaultAction`.
    #[test]
    fn classify_resolved_by_hard_list_membership() {
        let s = EnforceShared::new(
            Policy {
                blocked_domains: vec!["reddit.com".into()],
                ..Policy::default()
            },
            true,
        );
        assert_eq!(s.classify_resolved("reddit.com"), ResolvedClass::Blocked);
        assert_eq!(s.classify_resolved("example.com"), ResolvedClass::Ignore);

        s.set_policy(Policy {
            allowed_domains: vec!["gmail.com".into()],
            default_action: DefaultAction::Block,
            ..Policy::default()
        });
        assert_eq!(s.classify_resolved("gmail.com"), ResolvedClass::Allowed);
        assert_eq!(s.classify_resolved("youtube.com"), ResolvedClass::Ignore);
    }

    /// Both hard lists resolve in the same pass, so a policy that blocks some sites *and* exempts
    /// others classifies each into its own set — something the old single-`domains` model could
    /// not express.
    #[test]
    fn both_hard_lists_classify_independently() {
        let s = EnforceShared::new(
            Policy {
                blocked_domains: vec!["reddit.com".into()],
                allowed_domains: vec!["docs.rs".into()],
                ..Policy::default()
            },
            true,
        );
        assert_eq!(s.classify_resolved("reddit.com"), ResolvedClass::Blocked);
        assert_eq!(s.classify_resolved("docs.rs"), ResolvedClass::Allowed);
        assert_eq!(s.classify_resolved("example.com"), ResolvedClass::Ignore);

        let targets = s.resolver_targets();
        assert!(targets.contains(&"reddit.com".to_string()));
        assert!(targets.contains(&"docs.rs".to_string()));
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
                blocked_domains: vec!["x.com".into()],
                ..Policy::default()
            },
            false,
        );
        let targets = s.resolver_targets();
        assert!(targets.contains(&"x.com".to_string()));
        assert!(targets.contains(&"twimg.com".to_string()));
        assert!(targets.contains(&"twitter.com".to_string()));
        assert!(targets.contains(&"t.co".to_string()));
    }

    /// The allow list is expanded too. Without this, allow-listing a multi-domain property under
    /// block-by-default would exempt the main domain but not the sibling domains its assets load
    /// from, so the site would half-load.
    #[test]
    fn effective_policy_expands_siblings_on_the_allow_list_too() {
        let s = EnforceShared::new(
            Policy {
                allowed_domains: vec!["x.com".into()],
                default_action: DefaultAction::Block,
                ..Policy::default()
            },
            false,
        );
        let targets = s.resolver_targets();
        assert!(targets.contains(&"x.com".to_string()));
        assert!(targets.contains(&"twimg.com".to_string()));
        assert_eq!(s.classify_resolved("twimg.com"), ResolvedClass::Allowed);
    }
}
