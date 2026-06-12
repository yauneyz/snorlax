//! Enforcement orchestration (architecture §4.1). v1 enforces website blocking via the
//! WinDivert packet engine (enforce::divert) — outbound DNS interception + DoT drop + live
//! connection reset — backed by persistent Windows-Firewall DoT/DoH-IP rules (enforce::wfp),
//! and app blocking via process termination (enforce::apps). See the note in lib.rs for what's
//! deferred.

pub mod apps;
pub mod divert;
pub mod dns;
pub mod wfp;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tokio::sync::mpsc::UnboundedSender;

use crate::model::Policy;

/// State shared between the always-running enforcement threads (divert engine, reset worker,
/// app blocker) and the core dispatcher. They read this so policy/focus changes take effect
/// live; `reset_tx` lets the core ask the reset worker to tear down live browser flows.
pub struct EnforceShared {
    pub policy: Mutex<Policy>,
    pub focus_active: AtomicBool,
    reset_tx: UnboundedSender<()>,
}

impl EnforceShared {
    pub fn new(policy: Policy, focus_active: bool, reset_tx: UnboundedSender<()>) -> Self {
        EnforceShared {
            policy: Mutex::new(policy),
            focus_active: AtomicBool::new(focus_active),
            reset_tx,
        }
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
        *self.policy.lock().unwrap() = policy;
    }

    /// Ask the reset worker to tear down live browser/blocked-app TCP flows. Fire-and-forget;
    /// a closed channel (worker gone) is ignored.
    pub fn request_reset(&self) {
        let _ = self.reset_tx.send(());
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
    } else {
        teardown_network();
    }
}

/// Remove all of FocusLock's machine-level firewall changes (focus-off and the killswitch).
pub fn teardown_network() {
    wfp::clear_rules();
}
