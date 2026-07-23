//! The browser handshake dead-man's switch, as a pure state machine.
//!
//! Backends feed it, each tick, the set of *root* browser processes currently running (see
//! [`roots`]) plus the latest heartbeat per process; it returns the [`Action`]s to take (warn the
//! user, gracefully close, or force-kill). It owns no OS calls and no clock — `now` is passed in —
//! so the escalation policy is testable in isolation.
//!
//! Escalation (graceful): a supported browser that stops proving the extension is alive goes
//! `Ok → Warned → Closing → Killing`; an unsupported browser (which can never host the extension)
//! skips the warning and goes `Ok → Closing → Killing`. Per-PID timers gate each step so a brief
//! hiccup is forgiven and a genuinely-dark browser is escalated within a few ticks.

use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use crate::browsers::BrowserClass;

/// The most recent heartbeat we have for a browser root process.
#[derive(Clone, Debug)]
pub struct Heartbeat {
    pub last_seen: Instant,
    /// The extension self-reported it can actually block (permissions + rules applied).
    pub healthy: bool,
}

/// A root (top-level) browser process the backend found running.
#[derive(Clone, Debug)]
pub struct BrowserProc {
    pub pid: u32,
    pub class: BrowserClass,
    /// Browser key from the classification table, for events/logs.
    pub key: String,
}

/// One process the backend enumerated, with enough info to find roots.
#[derive(Clone, Debug)]
pub struct ScannedProc {
    pub pid: u32,
    pub parent: Option<u32>,
    pub class: BrowserClass,
    pub key: String,
}

/// An instruction the backend must carry out.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Action {
    /// Tell the user this browser will be closed unless its extension comes back.
    Warn { pid: u32, browser: String },
    /// Ask the browser to close gracefully (WM_CLOSE / SIGTERM).
    Close { pid: u32, browser: String },
    /// Force-terminate the browser (TerminateProcess / SIGKILL). `first_attempt` lets backends
    /// notify the user once without repeating the notification on every kill retry.
    Kill {
        pid: u32,
        browser: String,
        first_attempt: bool,
    },
}

impl Action {
    pub fn pid(&self) -> u32 {
        match self {
            Action::Warn { pid, .. } | Action::Close { pid, .. } | Action::Kill { pid, .. } => *pid,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Ok,
    Warned,
    Closing,
    Killing,
}

struct Tracked {
    phase: Phase,
    since: Instant,
}

/// Tunable timings for the escalation ladder.
#[derive(Clone, Copy, Debug)]
pub struct Config {
    /// A heartbeat older than this is stale (browser is considered dark).
    pub ttl: Duration,
    /// How long a warned browser has to recover before we start closing it.
    pub warn_grace: Duration,
    /// How long after a graceful close before we force-kill.
    pub close_grace: Duration,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            ttl: Duration::from_secs(15),
            warn_grace: Duration::from_secs(10),
            close_grace: Duration::from_secs(8),
        }
    }
}

/// Reduce a flat process scan to the *root* browser processes. Chromium/Firefox spawn many helper
/// processes that share the parent's image name; we only act on the top-level one. A browser
/// process is a root unless its parent is a browser process of the **same key** (i.e. it is a
/// renderer/GPU/utility child of that browser). Two separately-launched instances of the same
/// browser are both roots (their parent is the shell, not a browser).
pub fn roots(scan: &[ScannedProc]) -> Vec<BrowserProc> {
    let by_pid: HashMap<u32, &ScannedProc> = scan.iter().map(|p| (p.pid, p)).collect();
    scan.iter()
        .filter(|p| match p.parent.and_then(|pp| by_pid.get(&pp)) {
            Some(parent) => parent.key != p.key, // child of same browser → not a root
            None => true,
        })
        .map(|p| BrowserProc {
            pid: p.pid,
            class: p.class,
            key: p.key.clone(),
        })
        .collect()
}

/// Re-key heartbeats reported by browser child processes to the root process the watchdog guards.
/// Native-messaging hosts are not guaranteed to be launched by the browser root; Chromium commonly
/// launches them from one of its child processes.
pub fn heartbeats_by_root(
    scan: &[ScannedProc],
    heartbeats: &HashMap<u32, Heartbeat>,
) -> HashMap<u32, Heartbeat> {
    let by_pid: HashMap<u32, &ScannedProc> = scan.iter().map(|p| (p.pid, p)).collect();
    let mut mapped = HashMap::new();

    for (&heartbeat_pid, heartbeat) in heartbeats {
        let Some(mut current) = by_pid.get(&heartbeat_pid).copied() else {
            continue;
        };
        let key = current.key.clone();
        let mut seen = HashSet::from([current.pid]);

        while let Some(parent_pid) = current.parent {
            let Some(parent) = by_pid.get(&parent_pid).copied() else {
                break;
            };
            if parent.key != key || !seen.insert(parent.pid) {
                break;
            }
            current = parent;
        }

        mapped
            .entry(current.pid)
            .and_modify(|existing: &mut Heartbeat| {
                if heartbeat.last_seen > existing.last_seen {
                    *existing = heartbeat.clone();
                }
            })
            .or_insert_with(|| heartbeat.clone());
    }

    mapped
}

/// Holds per-PID escalation state across ticks.
pub struct Watchdog {
    cfg: Config,
    phases: HashMap<u32, Tracked>,
}

impl Default for Watchdog {
    fn default() -> Self {
        Watchdog::new(Config::default())
    }
}

impl Watchdog {
    pub fn new(cfg: Config) -> Self {
        Watchdog {
            cfg,
            phases: HashMap::new(),
        }
    }

    /// Advance the state machine one tick and return the actions to perform now.
    ///
    /// `roots` is the current set of root browser processes (from [`roots`]); `heartbeats` is the
    /// latest heartbeat per root PID. Callers invoke this only while focus is active and the
    /// handshake feature is enabled — when it isn't, simply don't call `tick` (and call [`reset`]
    /// so a later re-enable starts clean).
    pub fn tick(
        &mut self,
        now: Instant,
        roots: &[BrowserProc],
        heartbeats: &HashMap<u32, Heartbeat>,
    ) -> Vec<Action> {
        let mut actions = Vec::new();
        let mut seen = HashSet::new();

        for proc in roots {
            seen.insert(proc.pid);
            let bad = match proc.class {
                BrowserClass::Supported => match heartbeats.get(&proc.pid) {
                    Some(hb) => !(hb.healthy && now.duration_since(hb.last_seen) <= self.cfg.ttl),
                    None => true,
                },
                BrowserClass::Unsupported => true,
            };

            let entry = self.phases.entry(proc.pid).or_insert(Tracked {
                phase: Phase::Ok,
                since: now,
            });

            if !bad {
                entry.phase = Phase::Ok;
                entry.since = now;
                continue;
            }

            match entry.phase {
                Phase::Ok => {
                    // Supported browsers get a warning grace first; unsupported go straight to close.
                    if proc.class == BrowserClass::Supported {
                        *entry = Tracked {
                            phase: Phase::Warned,
                            since: now,
                        };
                        actions.push(Action::Warn {
                            pid: proc.pid,
                            browser: proc.key.clone(),
                        });
                    } else {
                        *entry = Tracked {
                            phase: Phase::Closing,
                            since: now,
                        };
                        actions.push(Action::Close {
                            pid: proc.pid,
                            browser: proc.key.clone(),
                        });
                    }
                }
                Phase::Warned => {
                    if now.duration_since(entry.since) >= self.cfg.warn_grace {
                        *entry = Tracked {
                            phase: Phase::Closing,
                            since: now,
                        };
                        actions.push(Action::Close {
                            pid: proc.pid,
                            browser: proc.key.clone(),
                        });
                    }
                }
                Phase::Closing => {
                    if now.duration_since(entry.since) >= self.cfg.close_grace {
                        *entry = Tracked {
                            phase: Phase::Killing,
                            since: now,
                        };
                        actions.push(Action::Kill {
                            pid: proc.pid,
                            browser: proc.key.clone(),
                            first_attempt: true,
                        });
                    }
                }
                Phase::Killing => {
                    // Still alive after a kill attempt — keep trying until it disappears.
                    actions.push(Action::Kill {
                        pid: proc.pid,
                        browser: proc.key.clone(),
                        first_attempt: false,
                    });
                }
            }
        }

        // Forget processes that have exited so their PIDs can be reused cleanly.
        self.phases.retain(|pid, _| seen.contains(pid));
        actions
    }

    /// Drop all per-PID state. Call when the handshake feature is disabled or focus ends, so a
    /// later re-enable doesn't act on stale escalation state.
    pub fn reset(&mut self) {
        self.phases.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proc(pid: u32, class: BrowserClass, key: &str) -> BrowserProc {
        BrowserProc {
            pid,
            class,
            key: key.to_string(),
        }
    }

    fn scanned(pid: u32, parent: Option<u32>, class: BrowserClass, key: &str) -> ScannedProc {
        ScannedProc {
            pid,
            parent,
            class,
            key: key.to_string(),
        }
    }

    #[test]
    fn roots_filters_same_browser_children() {
        // Main chrome (100) with two renderer children, plus a separate firefox.
        let scan = vec![
            scanned(100, Some(1), BrowserClass::Supported, "chrome"),
            scanned(101, Some(100), BrowserClass::Supported, "chrome"),
            scanned(102, Some(100), BrowserClass::Supported, "chrome"),
            scanned(200, Some(1), BrowserClass::Supported, "firefox"),
        ];
        let mut roots = roots(&scan);
        roots.sort_by_key(|p| p.pid);
        assert_eq!(roots.len(), 2);
        assert_eq!(roots[0].pid, 100);
        assert_eq!(roots[1].pid, 200);
    }

    #[test]
    fn child_process_heartbeat_is_mapped_to_browser_root() {
        let scan = vec![
            scanned(37132, Some(1), BrowserClass::Supported, "chrome"),
            scanned(14152, Some(37132), BrowserClass::Supported, "chrome"),
        ];
        let now = Instant::now();
        let heartbeats = HashMap::from([(
            14152,
            Heartbeat {
                last_seen: now,
                healthy: true,
            },
        )]);

        let mapped = heartbeats_by_root(&scan, &heartbeats);
        assert!(!mapped.contains_key(&14152));
        assert!(mapped
            .get(&37132)
            .is_some_and(|heartbeat| { heartbeat.healthy && heartbeat.last_seen == now }));
        assert!(Watchdog::default()
            .tick(now, &roots(&scan), &mapped)
            .is_empty());
    }

    #[test]
    fn fresh_healthy_heartbeat_is_left_alone() {
        let mut wd = Watchdog::default();
        let now = Instant::now();
        let mut hb = HashMap::new();
        hb.insert(
            100,
            Heartbeat {
                last_seen: now,
                healthy: true,
            },
        );
        let actions = wd.tick(now, &[proc(100, BrowserClass::Supported, "chrome")], &hb);
        assert!(actions.is_empty());
    }

    #[test]
    fn missing_heartbeat_escalates_warn_close_kill() {
        let cfg = Config {
            ttl: Duration::from_secs(15),
            warn_grace: Duration::from_secs(10),
            close_grace: Duration::from_secs(8),
        };
        let mut wd = Watchdog::new(cfg);
        let t0 = Instant::now();
        let hb = HashMap::new(); // no heartbeat ever
        let roots = vec![proc(100, BrowserClass::Supported, "chrome")];

        // Tick 1: warn.
        let a = wd.tick(t0, &roots, &hb);
        assert_eq!(
            a,
            vec![Action::Warn {
                pid: 100,
                browser: "chrome".into()
            }]
        );

        // Still within warn grace: nothing.
        let a = wd.tick(t0 + Duration::from_secs(5), &roots, &hb);
        assert!(a.is_empty());

        // Past warn grace: close.
        let a = wd.tick(t0 + Duration::from_secs(11), &roots, &hb);
        assert_eq!(
            a,
            vec![Action::Close {
                pid: 100,
                browser: "chrome".into()
            }]
        );

        // Past close grace: kill.
        let a = wd.tick(t0 + Duration::from_secs(20), &roots, &hb);
        assert_eq!(
            a,
            vec![Action::Kill {
                pid: 100,
                browser: "chrome".into(),
                first_attempt: true,
            }]
        );

        // Still present next tick: keep killing.
        let a = wd.tick(t0 + Duration::from_secs(21), &roots, &hb);
        assert_eq!(
            a,
            vec![Action::Kill {
                pid: 100,
                browser: "chrome".into(),
                first_attempt: false,
            }]
        );
    }

    #[test]
    fn recovered_heartbeat_cancels_escalation() {
        let mut wd = Watchdog::default();
        let t0 = Instant::now();
        let roots = vec![proc(100, BrowserClass::Supported, "chrome")];

        // Warn first.
        let _ = wd.tick(t0, &roots, &HashMap::new());

        // Heartbeat returns healthy → back to Ok, no action.
        let mut hb = HashMap::new();
        hb.insert(
            100,
            Heartbeat {
                last_seen: t0 + Duration::from_secs(2),
                healthy: true,
            },
        );
        let a = wd.tick(t0 + Duration::from_secs(2), &roots, &hb);
        assert!(a.is_empty());
    }

    #[test]
    fn unhealthy_heartbeat_is_treated_as_bad() {
        let mut wd = Watchdog::default();
        let now = Instant::now();
        let mut hb = HashMap::new();
        hb.insert(
            100,
            Heartbeat {
                last_seen: now,
                healthy: false, // present but can't block
            },
        );
        let a = wd.tick(now, &[proc(100, BrowserClass::Supported, "chrome")], &hb);
        assert_eq!(
            a,
            vec![Action::Warn {
                pid: 100,
                browser: "chrome".into()
            }]
        );
    }

    #[test]
    fn unsupported_browser_skips_warning() {
        let mut wd = Watchdog::default();
        let t0 = Instant::now();
        let roots = vec![proc(300, BrowserClass::Unsupported, "librewolf")];
        // Straight to Close, no Warn.
        let a = wd.tick(t0, &roots, &HashMap::new());
        assert_eq!(
            a,
            vec![Action::Close {
                pid: 300,
                browser: "librewolf".into()
            }]
        );
        // Then Kill after close grace.
        let a = wd.tick(t0 + Duration::from_secs(9), &roots, &HashMap::new());
        assert_eq!(
            a,
            vec![Action::Kill {
                pid: 300,
                browser: "librewolf".into(),
                first_attempt: true,
            }]
        );
    }

    #[test]
    fn exited_pid_state_is_forgotten() {
        let mut wd = Watchdog::default();
        let t0 = Instant::now();
        let roots = vec![proc(100, BrowserClass::Supported, "chrome")];
        let _ = wd.tick(t0, &roots, &HashMap::new()); // Warn → tracked
                                                      // Process gone: empty scan clears its state.
        let a = wd.tick(t0 + Duration::from_secs(1), &[], &HashMap::new());
        assert!(a.is_empty());
        // Same PID reappears → starts fresh at Warn, not mid-escalation.
        let a = wd.tick(t0 + Duration::from_secs(2), &roots, &HashMap::new());
        assert_eq!(
            a,
            vec![Action::Warn {
                pid: 100,
                browser: "chrome".into()
            }]
        );
    }
}
