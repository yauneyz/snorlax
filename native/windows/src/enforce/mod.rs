//! Enforcement orchestration (architecture §4.1). The `Enforcer` trait collapses to one idea:
//! `apply(policy, focus_active)`. v1 enforces website blocking via the loopback DNS sinkhole +
//! pointing adapters' DNS at it + a Windows-Firewall DoT block, and app blocking via process
//! termination. See the module-level note in lib.rs for what's deferred.

pub mod apps;
pub mod dns;
pub mod wfp;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use crate::model::Policy;

/// State shared between the always-running enforcement tasks (sinkhole, app blocker) and the
/// core dispatcher. The tasks read this each tick so policy/focus changes take effect live.
pub struct EnforceShared {
    pub policy: Mutex<Policy>,
    pub focus_active: AtomicBool,
}

impl EnforceShared {
    pub fn new(policy: Policy, focus_active: bool) -> Self {
        EnforceShared {
            policy: Mutex::new(policy),
            focus_active: AtomicBool::new(focus_active),
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
}

/// Toggle the network-redirection layer (adapter DNS + firewall). The sinkhole + app-blocker
/// tasks run for the whole service lifetime and self-gate on `focus_active`; only the
/// redirection needs explicit set-up/tear-down so a normal machine isn't affected when focus
/// is off.
pub fn apply_network(active: bool) {
    if active {
        dns::point_adapters_to_sinkhole();
        wfp::block_dns_over_tls();
    } else {
        teardown_network();
    }
}

/// Remove all of FocusLock's machine-level changes (used on focus-off and by the killswitch).
pub fn teardown_network() {
    dns::restore_adapter_dns();
    wfp::clear_rules();
}
