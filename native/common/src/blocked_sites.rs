//! Opt-in daily counts of blocked site visits for the desktop Stats page (mirrors `BlockedSiteDay`
//! in packages/shared/src/protocol.ts).
//!
//! Only `(local date, hostname) -> count` is ever kept: no paths, no query strings, no timestamps
//! finer than a day. Nothing is recorded unless `Settings::blocked_site_stats_enabled` is on, and
//! the data never leaves the machine. The daemon stores it in its own file (not `state.json`) so
//! deleting it doesn't leave a copy behind in the state backup.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use talysman_engine::time::{date_string, LocalNow};

/// Days kept, today included. Matches the Stats page's longest range.
pub const RETENTION_DAYS: i64 = 30;
/// Distinct hosts kept per day, so a misbehaving caller can't grow the file without bound.
pub const MAX_HOSTS_PER_DAY: usize = 500;
const MAX_HOST_LEN: usize = 253;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BlockedSiteDay {
    /// Local date ("YYYY-MM-DD") the visits were blocked on.
    pub local_date: String,
    /// Hostname (lowercased, without a leading `www.`) → blocked visits that day.
    pub hosts: BTreeMap<String, u32>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BlockedSites {
    /// Oldest first.
    #[serde(default)]
    pub days: Vec<BlockedSiteDay>,
}

/// Reduce an extension-supplied hostname to the form we store, or `None` if it isn't one.
pub fn normalize_host(raw: &str) -> Option<String> {
    let host = raw.trim().trim_end_matches('.').to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);
    let valid = !host.is_empty()
        && host.len() <= MAX_HOST_LEN
        && host.split('.').all(|label| !label.is_empty() && label.len() <= 63)
        && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.');
    valid.then(|| host.to_string())
}

impl BlockedSites {
    /// Count one blocked visit to `host` today. Returns whether anything changed.
    pub fn record(&mut self, host: &str, now: &LocalNow) -> bool {
        let Some(host) = normalize_host(host) else { return false };
        self.prune(now);
        let today = now.date_string();
        if self.days.last().is_none_or(|d| d.local_date != today) {
            self.days.push(BlockedSiteDay { local_date: today, hosts: BTreeMap::new() });
        }
        let day = self.days.last_mut().unwrap();
        if !day.hosts.contains_key(&host) && day.hosts.len() >= MAX_HOSTS_PER_DAY {
            return false;
        }
        let count = day.hosts.entry(host).or_insert(0);
        *count = count.saturating_add(1);
        true
    }

    /// Drop days older than `RETENTION_DAYS`. Returns whether anything was dropped.
    pub fn prune(&mut self, now: &LocalNow) -> bool {
        let cutoff = date_string(now.day() - (RETENTION_DAYS - 1));
        let before = self.days.len();
        self.days.retain(|d| d.local_date >= cutoff);
        self.days.len() != before
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY_MS: i64 = 24 * 60 * 60 * 1000;

    fn at_day(day: i64) -> LocalNow {
        LocalNow::new(1_790_000_000_000 + day * DAY_MS, 0)
    }

    #[test]
    fn hosts_are_normalized_and_junk_is_refused() {
        assert_eq!(normalize_host("WWW.Example.COM."), Some("example.com".into()));
        assert_eq!(normalize_host("m.youtube.com"), Some("m.youtube.com".into()));
        assert_eq!(normalize_host("192.168.0.1"), Some("192.168.0.1".into()));
        assert_eq!(normalize_host(""), None);
        assert_eq!(normalize_host("example.com/path"), None);
        assert_eq!(normalize_host("a..b"), None);
        assert_eq!(normalize_host(&"a".repeat(300)), None);
    }

    #[test]
    fn visits_roll_up_per_day_and_host() {
        let mut sites = BlockedSites::default();
        assert!(sites.record("reddit.com", &at_day(0)));
        assert!(sites.record("www.reddit.com", &at_day(0)));
        assert!(sites.record("youtube.com", &at_day(1)));
        assert_eq!(sites.days.len(), 2);
        assert_eq!(sites.days[0].hosts["reddit.com"], 2);
        assert_eq!(sites.days[1].hosts["youtube.com"], 1);
    }

    #[test]
    fn old_days_fall_off() {
        let mut sites = BlockedSites::default();
        sites.record("reddit.com", &at_day(0));
        sites.record("reddit.com", &at_day(RETENTION_DAYS - 1));
        assert_eq!(sites.days.len(), 2);
        sites.record("reddit.com", &at_day(RETENTION_DAYS));
        assert_eq!(sites.days.len(), 2);
        assert!(sites.days.iter().all(|d| d.local_date != at_day(0).date_string()));
    }

    #[test]
    fn distinct_hosts_per_day_are_capped() {
        let mut sites = BlockedSites::default();
        for i in 0..MAX_HOSTS_PER_DAY {
            assert!(sites.record(&format!("site{i}.com"), &at_day(0)));
        }
        assert!(!sites.record("one-too-many.com", &at_day(0)));
        assert!(sites.record("site0.com", &at_day(0)), "known hosts still count");
    }
}
