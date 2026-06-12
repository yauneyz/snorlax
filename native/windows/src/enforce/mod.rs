//! Enforcement orchestration (architecture §4.1). v1 enforces website blocking via the
//! WinDivert packet engines (enforce::divert) — outbound DNS interception + DoT drop + SNI
//! inspection + tainted-destination drop + live connection reset — backed by persistent
//! Windows-Firewall DoT/DoH-IP rules (enforce::wfp), and app blocking via process termination
//! (enforce::apps). See the note in lib.rs for what's deferred.

pub mod apps;
pub mod divert;
pub mod dns;
pub mod properties;
pub mod sni;
pub mod wfp;

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tokio::sync::mpsc::UnboundedSender;

use crate::model::Policy;

/// Identifies a TCP flow as `(local, local_port, remote, remote_port)` — the same tuple the
/// reset worker reads from the OS TCP table, so SNI recorded by the 443 inspector can be matched
/// back to a connection.
pub type FlowKey = (IpAddr, u16, IpAddr, u16);

/// Cap on the flow→SNI map so it can't grow without bound; cleared wholesale when exceeded
/// (it's a best-effort hint for surgical reset, not authoritative state).
const FLOW_SNI_CAP: usize = 8192;

/// How long a tainted destination stays in the drop set without being re-observed serving a
/// blocked SNI. Short enough that a CDN IP rotating away from a blocked tenant unblocks soon;
/// re-tainted on the next observed blocked SNI (see blocking-upgrade.md).
const TAINT_TTL: Duration = Duration::from_secs(300);

/// How long an observed *allowed* SNI protects its destination IP from being tainted. Favors
/// precision on truly-shared CDN IPs: we never drop a destination we've just seen serve
/// allowed content.
const ALLOWED_GUARD_TTL: Duration = Duration::from_secs(60);

/// Cap on the tainted-IP set — every entry becomes a clause in the taint-drop WinDivert filter,
/// so this mirrors MAX_BURST_IPS' filter-string sanity. Oldest-last-seen evicted past the cap.
const MAX_TAINTED_IPS: usize = 100;

/// Cap on the allowed-destination guard map (best-effort hint; cleared wholesale when full).
const ALLOWED_DST_CAP: usize = 4096;

/// Cap on the per-flow drop set — each flow is a 4-clause term in the drop filter, so this keeps
/// the filter string compilable. A focus-on snapshot of one browser's 443 sockets is well under
/// this; oldest-last-seen evicted past the cap.
const MAX_DROPPED_FLOWS: usize = 80;

/// How long a per-flow drop persists. A focus session's established sockets don't come back (the
/// browser reconnects on a fresh local port → a new tuple not in the set), so this only bounds
/// stale entries; it matches TAINT_TTL for consistency.
const DROPPED_FLOW_TTL: Duration = TAINT_TTL;

/// Why a reset was requested. A focus-on transition tears everything down for a clean slate; a
/// policy change while already focused only needs to reap flows that are *newly* blocked, so it
/// uses the recorded SNI to avoid nuking allowed sites' sockets.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResetKind {
    FocusOn,
    PolicyChange,
}

/// State shared between the always-running enforcement threads (divert engine, SNI engine, reset
/// worker, app blocker) and the core dispatcher. They read this so policy/focus changes take
/// effect live; `reset_tx` lets the core ask the reset worker to tear down live browser flows.
pub struct EnforceShared {
    pub policy: Mutex<Policy>,
    pub focus_active: AtomicBool,
    /// SNI observed per TCP flow by the 443 inspector (enforce::divert), used by the reset worker
    /// to reset only newly-blocked flows on a policy change.
    flow_sni: Mutex<HashMap<FlowKey, String>>,
    /// Destinations observed serving a blocked SNI; all 443 egress to them is dropped by the
    /// taint-drop layer while focused (IpAddr → last-seen, for TTL eviction). This is the
    /// stateless backstop that kills pooled/coalesced sockets the RST burst misses — see
    /// blocking-upgrade.md.
    tainted: Mutex<HashMap<IpAddr, Instant>>,
    /// Destinations recently observed serving an *allowed* SNI — taint guard so a truly-shared
    /// CDN IP is never tainted (precision over completeness).
    allowed_dst: Mutex<HashMap<IpAddr, Instant>>,
    /// Exact TCP 4-tuples to drop egress on, seeded at focus-on from the browser's established
    /// 443 sockets. Per-tuple (not per-IP) so it reliably mutes an already-open socket — even one
    /// whose hostname we never observed (opened before recording) — without blocking new
    /// connections to the same IP: an allowed site reconnects on a fresh local port (a different
    /// tuple) and is unaffected. This is the reliable form of the RST burst's clean-slate teardown.
    dropped_flows: Mutex<HashMap<FlowKey, Instant>>,
    /// Bumped on every taint-set / drop-flow membership change; the taint-drop manager polls it to
    /// know when to rebuild its drop filter.
    taint_gen: AtomicU64,
    reset_tx: UnboundedSender<ResetKind>,
}

impl EnforceShared {
    pub fn new(policy: Policy, focus_active: bool, reset_tx: UnboundedSender<ResetKind>) -> Self {
        EnforceShared {
            policy: Mutex::new(Self::effective(policy)),
            focus_active: AtomicBool::new(focus_active),
            flow_sni: Mutex::new(HashMap::new()),
            tainted: Mutex::new(HashMap::new()),
            allowed_dst: Mutex::new(HashMap::new()),
            dropped_flows: Mutex::new(HashMap::new()),
            taint_gen: AtomicU64::new(0),
            reset_tx,
        }
    }

    /// Turn an authored policy into the form the service enforces: domains expanded with the
    /// siblings of any known multi-domain property (properties::expand_domains). The authored
    /// policy stays the user's clean input in PersistentState; only this enforced copy is
    /// expanded, so DNS sinkholing and SNI matching both cover sibling/CDN domains.
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

    pub fn set_policy(&self, policy: Policy) {
        *self.policy.lock().unwrap() = Self::effective(policy);
    }

    /// Ask the reset worker to tear down live browser/blocked-app TCP flows. Fire-and-forget;
    /// a closed channel (worker gone) is ignored.
    pub fn request_reset(&self, kind: ResetKind) {
        let _ = self.reset_tx.send(kind);
    }

    /// Record the SNI seen on a TCP flow's ClientHello (called by the 443 inspector).
    pub fn record_flow_sni(&self, key: FlowKey, sni: String) {
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

    /// Taint a destination IP: it has been observed serving a blocked SNI, so the taint-drop
    /// layer should drop all further 443 egress to it. Skipped if the IP recently served an
    /// *allowed* SNI (shared-CDN guard). Refreshing an existing taint does not bump the
    /// generation — only membership changes do, so the drop filter isn't rebuilt per packet.
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
            // Evict the stalest entry to keep the drop filter bounded.
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

    /// Record that a destination IP served an *allowed* SNI, shielding it from tainting for
    /// ALLOWED_GUARD_TTL (called by the 443 inspector on every allowed ClientHello).
    pub fn note_allowed(&self, ip: IpAddr) {
        let mut allowed = self.allowed_dst.lock().unwrap();
        if allowed.len() >= ALLOWED_DST_CAP {
            allowed.clear();
        }
        allowed.insert(ip, Instant::now());
    }

    /// Remove an IP from the taint set (an allowed ClientHello to it was observed). Lets a
    /// destination recover precisely; bumps the generation only if it was tainted.
    pub fn untaint(&self, ip: IpAddr) {
        let removed = self.tainted.lock().unwrap().remove(&ip).is_some();
        if removed {
            self.taint_gen.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// Add an exact TCP flow to the per-tuple drop set (focus-on teardown of an established
    /// browser socket). Bumps the generation on a new tuple; refresh is a no-op.
    pub fn drop_flow(&self, key: FlowKey) {
        self.drop_flow_at(key, Instant::now())
    }

    fn drop_flow_at(&self, key: FlowKey, now: Instant) {
        let mut flows = self.dropped_flows.lock().unwrap();
        let existed = flows.insert(key, now).is_some();
        let mut changed = !existed;
        if flows.len() > MAX_DROPPED_FLOWS {
            if let Some(oldest) = flows.iter().min_by_key(|(_, t)| **t).map(|(k, _)| *k) {
                flows.remove(&oldest);
                changed = true;
            }
        }
        if changed {
            self.taint_gen.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// The current per-tuple drop set, TTL-evicted and sorted (stable filter strings).
    pub fn dropped_flows(&self) -> Vec<FlowKey> {
        self.dropped_flows_at(Instant::now())
    }

    fn dropped_flows_at(&self, now: Instant) -> Vec<FlowKey> {
        let mut flows = self.dropped_flows.lock().unwrap();
        let before = flows.len();
        flows.retain(|_, seen| now.duration_since(*seen) < DROPPED_FLOW_TTL);
        if flows.len() != before {
            self.taint_gen.fetch_add(1, Ordering::SeqCst);
        }
        let mut out: Vec<FlowKey> = flows.keys().copied().collect();
        out.sort();
        out
    }

    /// The current tainted destinations, TTL-evicted and sorted (stable filter strings). An
    /// eviction bumps the generation so the taint-drop manager rebuilds without the gone IP.
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

    /// Seed the taint set from every recorded flow whose SNI is blocked under the current policy.
    /// Pooled/coalesced sockets send no new ClientHello, so the SNI engine never re-fires on
    /// them — but the always-on recorder already captured their hostname when the socket opened.
    /// Calling this synchronously at focus-on (and on a policy change) taints those destinations
    /// immediately, in-memory, *without* waiting on the reset worker's DNS flush + process/TCP
    /// enumeration — closing the multi-second window in which a pre-existing socket keeps serving
    /// (see blocking-upgrade.md / the x.com HAR).
    pub fn seed_taints_from_flows(&self) {
        let policy = self.policy.lock().unwrap().clone();
        // Collect under the flow_sni lock, then release it before tainting (taint() takes other
        // locks; never hold two at once).
        let blocked: Vec<IpAddr> = {
            let flows = self.flow_sni.lock().unwrap();
            flows
                .iter()
                .filter(|(_, sni)| {
                    crate::policy_match::is_host_blocked(&policy, sni)
                        || crate::policy_match::is_doh_bypass_host(sni)
                })
                .map(|((_, _, remote, _), _)| *remote)
                .collect()
        };
        for ip in blocked {
            self.taint(ip);
        }
    }

    /// Drop all taint + flow-drop state (focus-off: a new session starts clean).
    pub fn clear_taints(&self) {
        let mut tainted = self.tainted.lock().unwrap();
        let mut flows = self.dropped_flows.lock().unwrap();
        let had = !tainted.is_empty() || !flows.is_empty();
        tainted.clear();
        flows.clear();
        self.allowed_dst.lock().unwrap().clear();
        if had {
            self.taint_gen.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// Monotonic counter of taint-set membership changes (poll-and-compare by the manager).
    pub fn taint_generation(&self) -> u64 {
        self.taint_gen.load(Ordering::SeqCst)
    }
}

/// Ensure the persistent firewall backstop is in force (focus on) or removed (focus off). The
/// divert engine + reset worker run for the whole service lifetime and self-gate on
/// `focus_active`; only these persistent rules need explicit set-up/tear-down, and they survive
/// a service kill (unlike the WinDivert layer).
pub fn apply_network(active: bool) {
    if active {
        wfp::block_dns_over_tls();
        wfp::block_doh_resolvers();
        wfp::block_quic();
    } else {
        teardown_network();
    }
}

/// Remove all of FocusLock's machine-level firewall changes (focus-off and the killswitch).
pub fn teardown_network() {
    wfp::clear_rules();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    fn shared() -> EnforceShared {
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        EnforceShared::new(Policy::default(), false, tx)
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
    fn taint_cap_evicts_stalest() {
        let s = shared();
        let now = Instant::now();
        for n in 0..MAX_TAINTED_IPS {
            s.taint_at(ip((n % 250) as u8), now + Duration::from_secs(n as u64));
        }
        // Distinct IPs: 10.0.0.0..=10.0.0.99 (n < 250 so no wrap). One more evicts the stalest.
        // Read time keeps every entry within TAINT_TTL so only the cap eviction is in play.
        s.taint_at(Ipv4Addr::new(10, 0, 1, 1).into(), now + Duration::from_secs(100));
        let ips = s.tainted_ips_at(now + Duration::from_secs(100));
        assert_eq!(ips.len(), MAX_TAINTED_IPS);
        assert!(!ips.contains(&ip(0)), "stalest taint must be evicted past the cap");
        assert!(ips.contains(&Ipv4Addr::new(10, 0, 1, 1).into()));
    }

    #[test]
    fn clear_taints_resets_everything() {
        let s = shared();
        s.taint(ip(1));
        s.note_allowed(ip(2));
        s.drop_flow((ip(3), 5000, ip(4), 443));
        let g = s.taint_generation();
        s.clear_taints();
        assert!(s.tainted_ips().is_empty());
        assert!(s.dropped_flows().is_empty());
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
        // Untainting an absent IP is a no-op (no generation bump).
        let g2 = s.taint_generation();
        s.untaint(ip(2));
        assert_eq!(s.taint_generation(), g2);
    }

    #[test]
    fn drop_flow_dedups_and_caps() {
        let s = shared();
        let now = Instant::now();
        let key = (ip(1), 5000u16, ip(2), 443u16);
        s.drop_flow_at(key, now);
        let g = s.taint_generation();
        s.drop_flow_at(key, now); // refresh, not a membership change
        assert_eq!(s.taint_generation(), g);
        assert_eq!(s.dropped_flows_at(now), vec![key]);
        // Fill past the cap; the stalest tuple is evicted.
        for n in 0..MAX_DROPPED_FLOWS {
            s.drop_flow_at(
                (ip(1), 6000 + n as u16, ip(2), 443),
                now + Duration::from_secs(n as u64 + 1),
            );
        }
        let flows = s.dropped_flows_at(now + Duration::from_secs(1));
        assert_eq!(flows.len(), MAX_DROPPED_FLOWS);
        assert!(!flows.contains(&key), "stalest flow must be evicted past the cap");
    }
}
