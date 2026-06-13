//! Persisted "antibodies" store (architecture §4.1, IP-first blocking).
//!
//! A durable `host -> { ips, last_seen }` map learned from real traffic by the always-on SNI
//! recorder (`enforce::divert::run_sni_engine`, which records ClientHello SNIs **even while
//! unfocused**). On focus-on we look up every blocked host's known IPs and pre-arm the suspect
//! set immediately — so a pooled/coalesced/opaque socket to a blocked destination dies at once
//! instead of coasting until something is observed live. This is the cross-session memory the
//! in-memory `flow_sni` map lacks: it survives focus-off, restarts, and reboots, and it keeps
//! growing whenever the blocker is running, "tuning our antibodies" against blocked sites.
//!
//! The store is best-effort: a missing/corrupt file just starts empty, writes are debounced and
//! never block enforcement correctness (a lost write only costs us a re-learn). It is bounded
//! (oldest-last-seen evicted past `MAX_HOSTS`).

use std::collections::{BTreeSet, HashMap};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::model::Policy;
use crate::policy_match::{is_doh_bypass_host, is_host_blocked};

/// Cap on distinct hosts retained; oldest-last-seen evicted past this.
const MAX_HOSTS: usize = 4096;
/// Cap on IPs retained per host (CDN rotation would otherwise grow this unbounded).
const MAX_IPS_PER_HOST: usize = 16;
/// Minimum interval between debounced disk flushes from the hot `record` path.
const FLUSH_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct HostEntry {
    ips: BTreeSet<IpAddr>,
    #[serde(rename = "lastSeenMs")]
    last_seen_ms: u64,
}

struct Inner {
    hosts: HashMap<String, HostEntry>,
    dirty: bool,
    last_flush: Instant,
}

/// Thread-safe persisted observation store. Held behind an `Arc` on `EnforceShared`.
pub struct ObservationStore {
    inner: Mutex<Inner>,
}

impl ObservationStore {
    /// Load from the on-disk store (empty on missing/corrupt file).
    pub fn load() -> Self {
        Self::load_from(&crate::paths::observations_file())
    }

    fn load_from(path: &Path) -> Self {
        let hosts = std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<HashMap<String, HostEntry>>(&bytes).ok())
            .unwrap_or_default();
        ObservationStore {
            inner: Mutex::new(Inner {
                hosts,
                dirty: false,
                last_flush: Instant::now(),
            }),
        }
    }

    /// Record that `host` was observed resolving/connecting to `ip`. Hot path (called per
    /// recorded ClientHello, even unfocused) — cheap, with a debounced flush.
    pub fn record(&self, host: &str, ip: IpAddr) {
        let host = host.trim_end_matches('.').to_ascii_lowercase();
        if host.is_empty() {
            return;
        }
        let mut inner = self.inner.lock().unwrap();
        let now = now_ms();
        let entry = inner.hosts.entry(host).or_default();
        let added = entry.ips.insert(ip);
        entry.last_seen_ms = now;
        if entry.ips.len() > MAX_IPS_PER_HOST {
            // Drop an arbitrary (smallest) IP — we only need a working set, not history.
            if let Some(first) = entry.ips.iter().next().copied() {
                entry.ips.remove(&first);
            }
        }
        if added || inner.hosts.len() > MAX_HOSTS {
            inner.dirty = true;
        }
        evict_if_needed(&mut inner.hosts);
        maybe_flush(&mut inner);
    }

    /// IPs of every host whose name is blocked under `policy` (incl. DoH-bypass hosts). Used to
    /// pre-arm the suspect set at focus-on (blacklist + block-all).
    pub fn blocked_ips(&self, policy: &Policy) -> Vec<IpAddr> {
        let inner = self.inner.lock().unwrap();
        let mut out = BTreeSet::new();
        for (host, entry) in inner.hosts.iter() {
            if is_host_blocked(policy, host) || is_doh_bypass_host(host) {
                out.extend(entry.ips.iter().copied());
            }
        }
        out.into_iter().collect()
    }

    /// IPs of every host that is *allowed* under `policy` (i.e. not blocked). Used to pre-seed the
    /// clean/allow exception set at focus-on in whitelist mode so allowed sites aren't dropped.
    pub fn allowed_ips(&self, policy: &Policy) -> Vec<IpAddr> {
        let inner = self.inner.lock().unwrap();
        let mut out = BTreeSet::new();
        for (host, entry) in inner.hosts.iter() {
            if !is_host_blocked(policy, host) && !is_doh_bypass_host(host) {
                out.extend(entry.ips.iter().copied());
            }
        }
        out.into_iter().collect()
    }

    /// Force a flush to disk (e.g. on focus transitions / shutdown). Best-effort.
    pub fn flush(&self) {
        let mut inner = self.inner.lock().unwrap();
        flush_locked(&mut inner, &crate::paths::observations_file());
    }

    /// An empty in-memory store that never touches disk on its own — for unit tests in this and
    /// sibling enforcement modules.
    #[cfg(test)]
    pub fn empty_for_test() -> Self {
        ObservationStore {
            inner: Mutex::new(Inner {
                hosts: HashMap::new(),
                dirty: false,
                last_flush: Instant::now(),
            }),
        }
    }
}

fn maybe_flush(inner: &mut Inner) {
    if inner.dirty && inner.last_flush.elapsed() >= FLUSH_INTERVAL {
        flush_locked(inner, &crate::paths::observations_file());
    }
}

fn flush_locked(inner: &mut Inner, path: &Path) {
    if !inner.dirty {
        return;
    }
    match serde_json::to_vec(&inner.hosts) {
        Ok(bytes) => {
            if let Err(e) = atomic_write(path, &bytes) {
                tracing::warn!("observation store flush failed: {e}");
                return;
            }
            inner.dirty = false;
            inner.last_flush = Instant::now();
        }
        Err(e) => tracing::warn!("observation store serialize failed: {e}"),
    }
}

/// Write `bytes` to `path` via a temp file + rename so a crash mid-write can't corrupt the store.
fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp: PathBuf = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}

/// Evict the stalest hosts until at most `MAX_HOSTS` remain.
fn evict_if_needed(hosts: &mut HashMap<String, HostEntry>) {
    while hosts.len() > MAX_HOSTS {
        if let Some(stalest) = hosts
            .iter()
            .min_by_key(|(_, e)| e.last_seen_ms)
            .map(|(h, _)| h.clone())
        {
            hosts.remove(&stalest);
        } else {
            break;
        }
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Mode;
    use std::net::Ipv4Addr;

    fn ip(n: u8) -> IpAddr {
        Ipv4Addr::new(151, 101, 1, n).into()
    }

    fn empty() -> ObservationStore {
        ObservationStore {
            inner: Mutex::new(Inner {
                hosts: HashMap::new(),
                dirty: false,
                last_flush: Instant::now(),
            }),
        }
    }

    fn policy(mode: Mode, domains: &[&str]) -> Policy {
        Policy {
            mode,
            domains: domains.iter().map(|s| s.to_string()).collect(),
            apps: Vec::new(),
        }
    }

    #[test]
    fn record_and_blocked_lookup() {
        let s = empty();
        s.record("reddit.com", ip(1));
        s.record("Reddit.com", ip(2)); // case-folded onto the same host
        s.record("example.com", ip(9));
        let blocked = s.blocked_ips(&policy(Mode::Blacklist, &["reddit.com"]));
        assert!(blocked.contains(&ip(1)));
        assert!(blocked.contains(&ip(2)));
        assert!(!blocked.contains(&ip(9)));
    }

    #[test]
    fn allowed_lookup_for_whitelist() {
        let s = empty();
        s.record("gmail.com", ip(1));
        s.record("youtube.com", ip(2));
        // Whitelist: only gmail.com is allowed → its IP is clean, youtube.com is blocked.
        let p = policy(Mode::Whitelist, &["gmail.com"]);
        let allowed = s.allowed_ips(&p);
        assert!(allowed.contains(&ip(1)));
        assert!(!allowed.contains(&ip(2)));
        let blocked = s.blocked_ips(&p);
        assert!(blocked.contains(&ip(2)));
        assert!(!blocked.contains(&ip(1)));
    }

    #[test]
    fn doh_hosts_are_blocked_sources() {
        let s = empty();
        s.record("cloudflare-dns.com", ip(5));
        // Even in an empty blacklist, a DoH-bypass host's IP is a blocked source.
        let blocked = s.blocked_ips(&policy(Mode::Blacklist, &[]));
        assert!(blocked.contains(&ip(5)));
    }

    #[test]
    fn evicts_stalest_past_cap() {
        let mut hosts = HashMap::new();
        for n in 0..(MAX_HOSTS + 5) {
            hosts.insert(
                format!("h{n}.com"),
                HostEntry {
                    ips: BTreeSet::new(),
                    last_seen_ms: n as u64,
                },
            );
        }
        evict_if_needed(&mut hosts);
        assert_eq!(hosts.len(), MAX_HOSTS);
        // The lowest last_seen_ms hosts (h0..h4) are gone.
        assert!(!hosts.contains_key("h0.com"));
        assert!(hosts.contains_key(&format!("h{}.com", MAX_HOSTS + 4)));
    }

    #[test]
    fn save_load_roundtrip() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("focuslock-obs-test-{}.json", std::process::id()));
        let s = empty();
        s.record("reddit.com", ip(1));
        {
            let mut inner = s.inner.lock().unwrap();
            inner.dirty = true;
            flush_locked(&mut inner, &path);
        }
        let reloaded = ObservationStore::load_from(&path);
        let blocked = reloaded.blocked_ips(&policy(Mode::Blacklist, &["reddit.com"]));
        assert!(blocked.contains(&ip(1)));
        let _ = std::fs::remove_file(&path);
    }
}
