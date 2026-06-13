//! Enforcement orchestration (architecture §4.1). Website blocking is **IP-first, guilty until
//! proven innocent**: a destination IP associated with a blocked domain is dropped by default;
//! the SNI engine then *exonerates* a connection that proves an allowed hostname on the wire.
//! The suspect-IP set is **pre-armed** at focus-on from three sources — the persisted
//! `observations` antibody store, the active `resolve`r, and the in-memory recorded flows — so a
//! pooled/coalesced/opaque socket to a blocked destination dies instantly instead of coasting
//! until observed live. Backed by persistent Windows-Firewall DoT/DoH-IP/QUIC rules
//! (enforce::wfp) and managed browser policies (enforce::browser_policy); app blocking is process
//! termination (enforce::apps). See the note in lib.rs for what's deferred.

pub mod apps;
pub mod browser_policy;
pub mod divert;
pub mod dns;
pub mod observations;
pub mod properties;
pub mod resolve;
pub mod sni;
pub mod wfp;

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::enforce::observations::ObservationStore;
use crate::model::{Mode, Policy};
use crate::policy_match::{is_doh_bypass_host, is_host_blocked};

/// Identifies a TCP flow as `(local, local_port, remote, remote_port)` — the tuple the SNI
/// inspector records so a hostname can be mapped back to a destination IP.
pub type FlowKey = (IpAddr, u16, IpAddr, u16);

/// Cap on the flow→SNI map so it can't grow without bound; cleared wholesale when exceeded
/// (it's a best-effort hint for taint seeding, not authoritative state).
const FLOW_SNI_CAP: usize = 8192;

/// How long a tainted (suspect) destination stays in the drop set without being re-observed /
/// re-seeded. Short enough that a CDN IP rotating away from a blocked tenant unblocks soon;
/// re-tainted on the next observed blocked SNI or resolver pass.
const TAINT_TTL: Duration = Duration::from_secs(300);

/// How long an observed *allowed* SNI protects its destination IP from being tainted (blacklist
/// taint-guard). Favors precision on truly-shared CDN IPs: we never drop a destination we've just
/// seen serve allowed content.
const ALLOWED_GUARD_TTL: Duration = Duration::from_secs(60);

/// How long a destination stays in the **clean** allow-exception set (whitelist mode) without
/// being re-seeded/re-observed. Comfortably longer than the resolver's refresh cadence so an
/// allowed site's IP doesn't lapse out of the exception mid-session.
const CLEAN_TTL: Duration = Duration::from_secs(900);

/// Cap on the tainted-IP set — every entry becomes a clause in the taint-drop WinDivert filter,
/// so this mirrors MAX_BURST_IPS' filter-string sanity. Oldest-last-seen evicted past the cap.
const MAX_TAINTED_IPS: usize = 100;

/// Cap on the clean allow-exception set (whitelist negative-filter clauses). Oldest-last-seen
/// evicted past the cap.
const MAX_CLEAN_IPS: usize = 200;

/// Cap on the allowed-destination guard map (best-effort hint; cleared wholesale when full).
const ALLOWED_DST_CAP: usize = 4096;

/// State shared between the always-running enforcement threads (divert engine, SNI engine,
/// taint-drop manager) and the core dispatcher. They read this so policy/focus changes take
/// effect live; the observation store and seeding helpers let focus-on pre-arm the drop set.
pub struct EnforceShared {
    pub policy: Mutex<Policy>,
    pub focus_active: AtomicBool,
    /// SNI observed per TCP flow by the 443 inspector (enforce::divert), used to seed taints on
    /// focus-on / policy change.
    flow_sni: Mutex<HashMap<FlowKey, String>>,
    /// Destinations to drop while focused: an IP associated with a blocked host, learned from the
    /// SNI engine, the resolver, the persisted observations, or the recorded flows. This is the
    /// stateless backstop that kills pooled/coalesced sockets — see blocking-upgrade.md.
    tainted: Mutex<HashMap<IpAddr, Instant>>,
    /// Destinations recently observed serving an *allowed* SNI — taint guard so a truly-shared CDN
    /// IP is never tainted in blacklist mode (precision over completeness).
    allowed_dst: Mutex<HashMap<IpAddr, Instant>>,
    /// The **clean** allow-exception set used in whitelist mode: IPs proven (by resolver,
    /// observation, or live allowed SNI) to serve an allowed host. The whitelist drop filter drops
    /// all 443 egress *except* to these, so allowed sites keep working while everything else is
    /// dropped by default.
    clean: Mutex<HashMap<IpAddr, Instant>>,
    /// Bumped on every taint-set / clean-set membership change; the taint-drop manager polls it to
    /// know when to rebuild its drop filter.
    taint_gen: AtomicU64,
    /// Persisted host→IP antibody store; written on every recorded ClientHello (even unfocused),
    /// read to pre-arm the suspect/clean sets at focus-on.
    observations: Arc<ObservationStore>,
}

impl EnforceShared {
    pub fn new(policy: Policy, focus_active: bool, observations: Arc<ObservationStore>) -> Self {
        EnforceShared {
            policy: Mutex::new(Self::effective(policy)),
            focus_active: AtomicBool::new(focus_active),
            flow_sni: Mutex::new(HashMap::new()),
            tainted: Mutex::new(HashMap::new()),
            allowed_dst: Mutex::new(HashMap::new()),
            clean: Mutex::new(HashMap::new()),
            taint_gen: AtomicU64::new(0),
            observations,
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

    /// The enforced policy's mode (drives the taint-drop filter polarity).
    pub fn mode(&self) -> Mode {
        self.policy.lock().unwrap().mode.clone()
    }

    pub fn set_policy(&self, policy: Policy) {
        *self.policy.lock().unwrap() = Self::effective(policy);
    }

    /// Handle to the persisted antibody store (for the resolver ticker / shutdown flush).
    pub fn observations(&self) -> &Arc<ObservationStore> {
        &self.observations
    }

    /// Record the SNI seen on a TCP flow's ClientHello (called by the 443 inspector, focused or
    /// not). Also persists the host→IP mapping to the antibody store so a future focus-on can
    /// pre-arm against this destination even across restarts.
    pub fn record_flow_sni(&self, key: FlowKey, sni: String) {
        self.observations.record(&sni, key.2);
        let mut map = self.flow_sni.lock().unwrap();
        if map.len() >= FLOW_SNI_CAP {
            map.clear();
        }
        map.insert(key, sni);
    }

    /// The SNI last recorded for a flow, if any.
    pub fn flow_sni(&self, key: &FlowKey) -> Option<String> {
        self.flow_sni.lock().unwrap().get(key).cloned()
    }

    /// Taint a destination IP: it serves (or has served) a blocked host, so the taint-drop layer
    /// should drop further 443 egress to it. Skipped if the IP recently served an *allowed* SNI
    /// (shared-CDN guard). Refreshing an existing taint does not bump the generation.
    pub fn taint(&self, ip: IpAddr) {
        self.taint_at(ip, Instant::now())
    }

    fn taint_at(&self, ip: IpAddr, now: Instant) {
        {
            let allowed = self.allowed_dst.lock().unwrap();
            if let Some(seen) = allowed.get(&ip) {
                if now.duration_since(*seen) < ALLOWED_GUARD_TTL {
                    return;
                }
            }
        }
        let mut tainted = self.tainted.lock().unwrap();
        let existed = tainted.insert(ip, now).is_some();
        let mut changed = !existed;
        if tainted.len() > MAX_TAINTED_IPS {
            if let Some(oldest) = tainted.iter().min_by_key(|(_, t)| **t).map(|(ip, _)| *ip) {
                tainted.remove(&oldest);
                changed = true;
            }
        }
        if changed {
            tracing::debug!("tainted destination {ip}");
            self.taint_gen.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// Record that a destination served an *allowed* SNI: shields it from tainting for
    /// ALLOWED_GUARD_TTL (blacklist guard) and adds it to the durable clean allow-exception set
    /// (whitelist). Called by the 443 inspector on every allowed ClientHello.
    pub fn note_allowed(&self, ip: IpAddr) {
        {
            let mut allowed = self.allowed_dst.lock().unwrap();
            if allowed.len() >= ALLOWED_DST_CAP {
                allowed.clear();
            }
            allowed.insert(ip, Instant::now());
        }
        self.mark_clean(ip);
    }

    /// Add an IP to the clean allow-exception set (whitelist). Bumps the generation on a new
    /// member so the whitelist drop filter is rebuilt to spare it.
    pub fn mark_clean(&self, ip: IpAddr) {
        self.mark_clean_at(ip, Instant::now())
    }

    fn mark_clean_at(&self, ip: IpAddr, now: Instant) {
        let mut clean = self.clean.lock().unwrap();
        let existed = clean.insert(ip, now).is_some();
        let mut changed = !existed;
        if clean.len() > MAX_CLEAN_IPS {
            if let Some(oldest) = clean.iter().min_by_key(|(_, t)| **t).map(|(ip, _)| *ip) {
                clean.remove(&oldest);
                changed = true;
            }
        }
        if changed {
            self.taint_gen.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// Remove an IP from the taint set (an allowed ClientHello to it was observed). Lets a
    /// destination recover precisely; bumps the generation only if it was tainted.
    pub fn untaint(&self, ip: IpAddr) {
        let removed = self.tainted.lock().unwrap().remove(&ip).is_some();
        if removed {
            self.taint_gen.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// The current tainted destinations, TTL-evicted and sorted (stable filter strings).
    pub fn tainted_ips(&self) -> Vec<IpAddr> {
        self.tainted_ips_at(Instant::now())
    }

    fn tainted_ips_at(&self, now: Instant) -> Vec<IpAddr> {
        let mut tainted = self.tainted.lock().unwrap();
        let before = tainted.len();
        tainted.retain(|_, seen| now.duration_since(*seen) < TAINT_TTL);
        if tainted.len() != before {
            self.taint_gen.fetch_add(1, Ordering::SeqCst);
        }
        let mut ips: Vec<IpAddr> = tainted.keys().copied().collect();
        ips.sort();
        ips
    }

    /// The current clean allow-exception IPs, TTL-evicted and sorted (stable filter strings).
    pub fn clean_ips(&self) -> Vec<IpAddr> {
        self.clean_ips_at(Instant::now())
    }

    fn clean_ips_at(&self, now: Instant) -> Vec<IpAddr> {
        let mut clean = self.clean.lock().unwrap();
        let before = clean.len();
        clean.retain(|_, seen| now.duration_since(*seen) < CLEAN_TTL);
        if clean.len() != before {
            self.taint_gen.fetch_add(1, Ordering::SeqCst);
        }
        let mut ips: Vec<IpAddr> = clean.keys().copied().collect();
        ips.sort();
        ips
    }

    /// Seed the taint set from every recorded flow whose SNI is blocked under the current policy.
    /// Pooled/coalesced sockets send no new ClientHello, so the SNI engine never re-fires on them
    /// — but the always-on recorder already captured their hostname. Calling this synchronously at
    /// focus-on taints those destinations immediately, in-memory.
    pub fn seed_taints_from_flows(&self) {
        let policy = self.policy.lock().unwrap().clone();
        let blocked: Vec<IpAddr> = {
            let flows = self.flow_sni.lock().unwrap();
            flows
                .iter()
                .filter(|(_, sni)| is_host_blocked(&policy, sni) || is_doh_bypass_host(sni))
                .map(|((_, _, remote, _), _)| *remote)
                .collect()
        };
        for ip in blocked {
            self.taint(ip);
        }
    }

    /// Pre-arm the live drop sets from the persisted antibody store, dispatched by mode. Called
    /// synchronously at focus-on / policy change *before* the taint-drop manager's next poll so a
    /// pooled socket to a blocked destination dies within ~50ms instead of leaking.
    pub fn prearm_from_store(&self) {
        let policy = self.policy_snapshot();
        match policy.mode {
            Mode::Blacklist | Mode::BlockAll => {
                for ip in self.observations.blocked_ips(&policy) {
                    self.taint(ip);
                }
            }
            Mode::Whitelist => {
                for ip in self.observations.allowed_ips(&policy) {
                    self.mark_clean(ip);
                }
            }
        }
    }

    /// Ingest one resolved `host → ip` mapping from the active resolver. Always grows the antibody
    /// store; while focused, also arms the live set appropriate to the mode (taint a blocked host's
    /// IP, or mark an allowed host's IP clean). A no-op for the live set while unfocused (the
    /// taint-drop manager clears its sets when focus is off).
    pub fn ingest_resolved(&self, host: &str, ip: IpAddr) {
        self.observations.record(host, ip);
        if !self.is_active() {
            return;
        }
        let policy = self.policy_snapshot();
        let blocked = is_host_blocked(&policy, host) || is_doh_bypass_host(host);
        match policy.mode {
            Mode::Whitelist => {
                if !blocked {
                    self.mark_clean(ip);
                }
            }
            Mode::Blacklist => {
                if blocked {
                    self.taint(ip);
                }
            }
            Mode::BlockAll => {}
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

    /// Drop all session drop/clean state (focus-off: a new session starts clean). The durable
    /// antibody store on disk is *retained* — only the in-memory live sets are cleared.
    pub fn clear_taints(&self) {
        let mut tainted = self.tainted.lock().unwrap();
        let mut clean = self.clean.lock().unwrap();
        let had = !tainted.is_empty() || !clean.is_empty();
        tainted.clear();
        clean.clear();
        self.allowed_dst.lock().unwrap().clear();
        if had {
            self.taint_gen.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// Monotonic counter of taint/clean-set membership changes (poll-and-compare by the manager).
    pub fn taint_generation(&self) -> u64 {
        self.taint_gen.load(Ordering::SeqCst)
    }
}

/// Ensure the persistent firewall backstop is in force (focus on) or removed (focus off). The
/// divert engine + SNI engine + taint-drop manager run for the whole service lifetime and
/// self-gate on `focus_active`; only these persistent rules need explicit set-up/tear-down, and
/// they survive a service kill (unlike the WinDivert layer).
pub fn apply_network(active: bool) {
    if active {
        wfp::block_dns_over_tls();
        wfp::block_doh_resolvers();
        wfp::block_quic();
    } else {
        teardown_network();
    }
}

/// Remove all of FocusLock's machine-level changes (focus-off and the killswitch): firewall
/// rules and the managed browser policy.
pub fn teardown_network() {
    wfp::clear_rules();
    browser_policy::clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    fn shared() -> EnforceShared {
        EnforceShared::new(Policy::default(), false, Arc::new(ObservationStore::empty_for_test()))
    }

    fn ip(n: u8) -> IpAddr {
        Ipv4Addr::new(10, 0, 0, n).into()
    }

    #[test]
    fn taint_bumps_generation_only_on_membership_change() {
        let s = shared();
        let g0 = s.taint_generation();
        s.taint(ip(1));
        let g1 = s.taint_generation();
        assert!(g1 > g0, "new taint must bump generation");
        s.taint(ip(1)); // refresh, not a membership change
        assert_eq!(s.taint_generation(), g1);
        assert_eq!(s.tainted_ips(), vec![ip(1)]);
    }

    #[test]
    fn taint_ttl_evicts_and_bumps_generation() {
        let s = shared();
        let now = Instant::now();
        s.taint_at(ip(1), now);
        s.taint_at(ip(2), now + TAINT_TTL); // still fresh at eviction time
        let g = s.taint_generation();
        let ips = s.tainted_ips_at(now + TAINT_TTL); // ip1 exactly TTL old → evicted
        assert_eq!(ips, vec![ip(2)]);
        assert!(s.taint_generation() > g, "eviction must bump generation");
    }

    #[test]
    fn allowed_guard_blocks_tainting() {
        let s = shared();
        s.note_allowed(ip(1));
        s.taint(ip(1));
        assert!(s.tainted_ips().is_empty(), "recently-allowed IP must not be tainted");
        // Once the guard ages out, the same IP can be tainted.
        s.taint_at(ip(1), Instant::now() + ALLOWED_GUARD_TTL);
        assert_eq!(s.tainted_ips_at(Instant::now()), vec![ip(1)]);
    }

    #[test]
    fn note_allowed_marks_clean() {
        let s = shared();
        s.note_allowed(ip(1));
        assert_eq!(s.clean_ips(), vec![ip(1)]);
    }

    #[test]
    fn clean_ttl_evicts() {
        let s = shared();
        let now = Instant::now();
        s.mark_clean_at(ip(1), now);
        s.mark_clean_at(ip(2), now + CLEAN_TTL);
        let ips = s.clean_ips_at(now + CLEAN_TTL); // ip1 exactly TTL old → evicted
        assert_eq!(ips, vec![ip(2)]);
    }

    #[test]
    fn taint_cap_evicts_stalest() {
        let s = shared();
        let now = Instant::now();
        for n in 0..MAX_TAINTED_IPS {
            s.taint_at(ip((n % 250) as u8), now + Duration::from_secs(n as u64));
        }
        s.taint_at(Ipv4Addr::new(10, 0, 1, 1).into(), now + Duration::from_secs(100));
        let ips = s.tainted_ips_at(now + Duration::from_secs(100));
        assert_eq!(ips.len(), MAX_TAINTED_IPS);
        assert!(!ips.contains(&ip(0)), "stalest taint must be evicted past the cap");
        assert!(ips.contains(&Ipv4Addr::new(10, 0, 1, 1).into()));
    }

    #[test]
    fn clear_taints_resets_session_state() {
        let s = shared();
        s.taint(ip(1));
        s.mark_clean(ip(2));
        let g = s.taint_generation();
        s.clear_taints();
        assert!(s.tainted_ips().is_empty());
        assert!(s.clean_ips().is_empty());
        assert!(s.taint_generation() > g);
        // The allowed guard was cleared too: ip2 is taintable immediately.
        s.taint(ip(2));
        assert_eq!(s.tainted_ips(), vec![ip(2)]);
    }

    #[test]
    fn untaint_removes_and_bumps() {
        let s = shared();
        s.taint(ip(1));
        let g = s.taint_generation();
        s.untaint(ip(1));
        assert!(s.tainted_ips().is_empty());
        assert!(s.taint_generation() > g);
        let g2 = s.taint_generation();
        s.untaint(ip(2));
        assert_eq!(s.taint_generation(), g2);
    }

    #[test]
    fn prearm_blacklist_taints_known_blocked_ips() {
        let s = EnforceShared::new(
            Policy {
                mode: Mode::Blacklist,
                domains: vec!["reddit.com".into()],
                apps: Vec::new(),
            },
            true,
            Arc::new(ObservationStore::empty_for_test()),
        );
        s.observations.record("reddit.com", ip(7));
        s.observations.record("example.com", ip(8));
        s.prearm_from_store();
        let ips = s.tainted_ips();
        assert!(ips.contains(&ip(7)));
        assert!(!ips.contains(&ip(8)));
    }

    #[test]
    fn prearm_whitelist_cleans_allowed_ips() {
        let s = EnforceShared::new(
            Policy {
                mode: Mode::Whitelist,
                domains: vec!["gmail.com".into()],
                apps: Vec::new(),
            },
            true,
            Arc::new(ObservationStore::empty_for_test()),
        );
        s.observations.record("gmail.com", ip(3));
        s.observations.record("youtube.com", ip(4));
        s.prearm_from_store();
        let clean = s.clean_ips();
        assert!(clean.contains(&ip(3)));
        assert!(!clean.contains(&ip(4)));
    }
}
