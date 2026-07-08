//! /etc/hosts managed-block sinkhole for macOS.
//!
//! macOS ships no dnsmasq, so the DNS-level sinkhole is a marker-delimited block spliced into
//! /etc/hosts while focus is active with a blacklist policy. Hosts entries do not cover
//! subdomains, so each domain also gets a `www.` variant; deeper subdomains are caught by the
//! pf IP rules fed from the warm resolver. Whitelist/block-all modes carry no hosts block —
//! pf enforces those wholesale.

use std::fmt::Write as _;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use crate::enforce::EnforceShared;
use crate::model::{Mode, Policy};
use crate::policy_match::DOH_BYPASS_HOSTS;

const BEGIN_MARK: &str = "# >>> talysman begin — managed block, do not edit >>>";
const END_MARK: &str = "# <<< talysman end <<<";
const POLL: Duration = Duration::from_millis(250);

fn hosts_file() -> PathBuf {
    std::env::var("TALYSMAN_HOSTS_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/etc/hosts"))
}

pub fn run_manager(shared: Arc<EnforceShared>, shutdown: tokio::sync::watch::Receiver<bool>) {
    let mut installed_gen: Option<u64> = None;
    let mut cleared_inactive = false;
    while !*shutdown.borrow() {
        if !shared.is_active() {
            if installed_gen.take().is_some() || !cleared_inactive {
                if let Err(e) = remove_config() {
                    tracing::warn!("failed to remove /etc/hosts sinkhole block: {e}");
                } else {
                    tracing::info!("/etc/hosts sinkhole removed (focus off)");
                }
                cleared_inactive = true;
            }
            std::thread::sleep(POLL);
            continue;
        }
        cleared_inactive = false;

        let gen = shared.generation();
        if installed_gen != Some(gen) {
            let policy = shared.policy_snapshot();
            match apply_policy(&policy) {
                Ok(()) => {
                    installed_gen = Some(gen);
                    tracing::info!("/etc/hosts sinkhole applied for {:?}", policy.mode);
                }
                Err(e) => tracing::warn!("failed to apply /etc/hosts sinkhole: {e}"),
            }
        }
        std::thread::sleep(POLL);
    }
}

pub fn apply_policy(policy: &Policy) -> std::io::Result<()> {
    let block = sinkhole_block(policy);
    if block.is_empty() {
        return remove_config();
    }
    let path = hosts_file();
    let current = std::fs::read_to_string(&path).unwrap_or_default();
    let next = splice_in(&current, &block);
    if next != current {
        std::fs::write(&path, next)?;
        flush_dns_cache();
    }
    Ok(())
}

pub fn remove_config() -> std::io::Result<()> {
    let path = hosts_file();
    let current = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    let next = splice_out(&current);
    if next != current {
        std::fs::write(&path, next)?;
        flush_dns_cache();
    }
    Ok(())
}

/// macOS caches DNS in two places: the Directory Services cache and mDNSResponder. Both must be
/// nudged for hosts-file edits to take effect immediately.
fn flush_dns_cache() {
    let _ = Command::new("dscacheutil").arg("-flushcache").output();
    let _ = Command::new("killall")
        .args(["-HUP", "mDNSResponder"])
        .output();
}

/// Build the marker-delimited sinkhole block for `policy`, or "" when no block applies.
fn sinkhole_block(policy: &Policy) -> String {
    if policy.mode != Mode::Blacklist {
        return String::new();
    }
    let mut names = sinkhole_names(&policy.domains);
    if names.is_empty() {
        // No user domains → no sinkhole; DoH endpoints only matter as a bypass of one.
        return String::new();
    }
    for h in DOH_BYPASS_HOSTS {
        let h = h.to_string();
        if !names.contains(&h) {
            names.push(h);
        }
    }
    let mut out = format!("{BEGIN_MARK}\n");
    for name in &names {
        let _ = writeln!(out, "0.0.0.0 {name}");
        let _ = writeln!(out, ":: {name}");
    }
    out.push_str(END_MARK);
    out.push('\n');
    out
}

/// Normalize the policy's domain patterns into concrete hosts-file names: strip wildcards and
/// trailing dots, lowercase, dedupe (order-preserving), and add a `www.` variant for bare
/// domains since hosts entries are exact-match only.
fn sinkhole_names(domains: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |name: String| {
        if !name.is_empty() && !out.contains(&name) {
            out.push(name);
        }
    };
    for domain in domains {
        let base = domain
            .trim()
            .trim_start_matches("*.")
            .trim_end_matches('.')
            .to_ascii_lowercase();
        if base.is_empty() {
            continue;
        }
        push(base.clone());
        if !base.starts_with("www.") {
            push(format!("www.{base}"));
        }
    }
    out
}

/// Return `current` with the Talysman block replaced (or appended). Idempotent.
fn splice_in(current: &str, block: &str) -> String {
    let mut base = splice_out(current);
    if !base.is_empty() && !base.ends_with('\n') {
        base.push('\n');
    }
    base.push_str(block);
    base
}

/// Return `current` with any Talysman marker block removed. Lines outside the markers are
/// preserved byte-for-byte; a dangling begin-marker (truncated file) drops through end-of-file
/// rather than eating user content silently forever.
fn splice_out(current: &str) -> String {
    let mut out = String::with_capacity(current.len());
    let mut inside = false;
    for line in current.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\n', '\r']);
        if !inside && trimmed == BEGIN_MARK {
            inside = true;
            continue;
        }
        if inside {
            if trimmed == END_MARK {
                inside = false;
            }
            continue;
        }
        out.push_str(line);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blacklist(domains: &[&str]) -> Policy {
        let mut p = Policy::default();
        p.mode = Mode::Blacklist;
        p.domains = domains.iter().map(|d| d.to_string()).collect();
        p
    }

    #[test]
    fn names_are_normalized_with_www_variants() {
        let names = sinkhole_names(&[
            "YouTube.com".into(),
            "*.reddit.com".into(),
            "youtube.com.".into(),
            "www.example.com".into(),
        ]);
        assert_eq!(
            names,
            vec![
                "youtube.com",
                "www.youtube.com",
                "reddit.com",
                "www.reddit.com",
                "www.example.com",
            ]
        );
    }

    #[test]
    fn block_has_v4_and_v6_lines_and_doh_hosts() {
        let block = sinkhole_block(&blacklist(&["youtube.com"]));
        assert!(block.starts_with(BEGIN_MARK));
        assert!(block.ends_with(&format!("{END_MARK}\n")));
        assert!(block.contains("0.0.0.0 youtube.com\n"));
        assert!(block.contains(":: youtube.com\n"));
        assert!(block.contains("0.0.0.0 www.youtube.com\n"));
        assert!(block.contains("0.0.0.0 dns.google\n"));
    }

    #[test]
    fn whitelist_and_block_all_produce_no_block() {
        let mut p = blacklist(&["example.com"]);
        p.mode = Mode::Whitelist;
        assert!(sinkhole_block(&p).is_empty());
        p.mode = Mode::BlockAll;
        assert!(sinkhole_block(&p).is_empty());
    }

    #[test]
    fn empty_blacklist_produces_no_block() {
        // No user domains → no hosts block, even though DoH hosts exist: DoH endpoints only
        // matter as a bypass of an actual sinkhole.
        assert!(sinkhole_block(&blacklist(&[])).is_empty());
    }

    #[test]
    fn splice_roundtrip_preserves_user_content() {
        let original = "127.0.0.1 localhost\n255.255.255.255 broadcasthost\n";
        let block = sinkhole_block(&blacklist(&["youtube.com"]));
        let spliced = splice_in(original, &block);
        assert!(spliced.starts_with(original));
        assert!(spliced.contains("0.0.0.0 youtube.com"));
        assert_eq!(splice_out(&spliced), original);
    }

    #[test]
    fn splice_in_is_idempotent_and_replaces() {
        let original = "127.0.0.1 localhost\n";
        let a = splice_in(original, &sinkhole_block(&blacklist(&["a.com"])));
        let b = splice_in(&a, &sinkhole_block(&blacklist(&["b.com"])));
        assert!(!b.contains("a.com"));
        assert!(b.contains("0.0.0.0 b.com"));
        assert_eq!(b.matches(BEGIN_MARK).count(), 1);
    }

    #[test]
    fn splice_in_handles_missing_trailing_newline() {
        let original = "127.0.0.1 localhost"; // no trailing newline
        let spliced = splice_in(original, &sinkhole_block(&blacklist(&["a.com"])));
        assert!(spliced.starts_with("127.0.0.1 localhost\n# >>>"));
    }

    #[test]
    fn splice_out_without_block_is_identity() {
        let original = "127.0.0.1 localhost\n# a comment\n";
        assert_eq!(splice_out(original), original);
    }

    #[test]
    fn apply_and_remove_against_temp_hosts_file() {
        let dir = std::env::temp_dir().join(format!("talysman-hosts-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("hosts");
        std::fs::write(&path, "127.0.0.1 localhost\n").unwrap();
        std::env::set_var("TALYSMAN_HOSTS_FILE", &path);

        apply_policy(&blacklist(&["youtube.com"])).unwrap();
        let after = std::fs::read_to_string(&path).unwrap();
        assert!(after.contains("0.0.0.0 youtube.com"));
        assert!(after.starts_with("127.0.0.1 localhost\n"));

        remove_config().unwrap();
        let cleaned = std::fs::read_to_string(&path).unwrap();
        assert_eq!(cleaned, "127.0.0.1 localhost\n");

        std::env::remove_var("TALYSMAN_HOSTS_FILE");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
