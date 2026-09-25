//! `talysman_engine` — the platform-free Talysman blocking engine.
//!
//! One implementation of everything that decides *what is blocked and who may change it*:
//! profiles (several active at once), schedules and one-shot events, the three key-gated override
//! paths, ScreenZen-style override pools, emergency unlocks, and the streak — plus the policy
//! model, domain matching, site catalog, premade lists, and key-hash verification it builds on.
//!
//! Consumers:
//! - the desktop daemons (`native/{linux,windows,macos}`, via `talysman_common`), natively;
//! - Talysman for Android, via uniffi (`native/engine-ffi`);
//! - TypeScript (desktop mock service and parity tests), via wasm (`native/engine-wasm`) and
//!   ts-rs-generated types in `packages/shared/src/generated`.
//!
//! No IO, no clock, no randomness: callers pass time (`Ctx`) and persist `EngineState` JSON.

pub mod activation;
pub mod effective;
pub mod engine;
pub mod migrate;
pub mod model;
pub mod pairing;
pub mod policy;
pub mod policy_match;
pub mod premade_lists;
pub mod restrictive;
pub mod schedule;
pub mod site_catalog;
pub mod streak;
pub mod time;

pub use engine::{Applied, Auth, Command, Ctx, Engine, EngineError, EngineSnapshot, Gate, PopupInfo, PopupTarget, Tick};
pub use effective::{Decision, EffectivePolicy, Layer, Verdict};

/// `cargo test --features ts export_bindings` writes packages/shared/src/generated/*.ts.
#[cfg(all(test, feature = "ts"))]
mod ts_export {
    use ts_rs::TS;

    #[test]
    fn export_bindings() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/shared/src/generated");
        let cfg = ts_rs::Config::new().with_out_dir(&dir);
        use crate::engine::*;
        EngineSnapshot::export_all(&cfg).unwrap();
        Command::export_all(&cfg).unwrap();
        Gate::export_all(&cfg).unwrap();
        PopupInfo::export_all(&cfg).unwrap();
        PopupTarget::export_all(&cfg).unwrap();
        Ctx::export_all(&cfg).unwrap();
        Auth::export_all(&cfg).unwrap();
        Applied::export_all(&cfg).unwrap();
        EngineError::export_all(&cfg).unwrap();
        crate::effective::Decision::export_all(&cfg).unwrap();
        crate::model::EngineState::export_all(&cfg).unwrap();
        crate::time::LocalNow::export_all(&cfg).unwrap();
    }
}
