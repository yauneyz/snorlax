//! End-to-end engine scenarios: the gating matrix (spec §3.4), override lifecycles (§3.5), pools
//! (§3.6), emergency unlocks (§3.7), the streak (§3.8), schedules (§3.9), and the worked examples
//! of the decision table (§3.2), each as a literal test.

use talysman_engine::engine::{codes, PopupTarget, ProfileInput};
use talysman_engine::model::*;
use talysman_engine::policy::{AppRef, Policy, RuleAction, SiteRule};
use talysman_engine::time::{days_from_civil, Weekday, DAY_MS, HOUR_MS, MINUTE_MS};
use talysman_engine::{Auth, Command, Ctx, Engine, Gate, Verdict};

const KEY: fn() -> Auth = || Auth::KeyVerified { key_id: "k".into() };

/// Monday 2026-09-21 00:00 UTC + `h` hours + `m` minutes, offset 0.
fn at(h: i64, m: i64) -> Ctx {
    Ctx::new(days_from_civil(2026, 9, 21) * DAY_MS + h * HOUR_MS + m * MINUTE_MS, 0, true)
}

fn input(id: &str, config: ProfileConfig) -> ProfileInput {
    ProfileInput { id: id.into(), name: id.into(), color: "#112233".into(), config }
}

fn blocks(domains: &[&str]) -> ProfileConfig {
    ProfileConfig {
        policy: Policy { blocked_domains: domains.iter().map(|d| d.to_string()).collect(), ..Default::default() },
        ..Default::default()
    }
}

fn instagram() -> AppRef {
    AppRef { android_package: Some("com.instagram.android".into()), label: "Instagram".into(), ..Default::default() }
}

fn pool(id: &str, items: Vec<ItemRef>, per_day: u8, minutes: u16, friction: Friction) -> Pool {
    Pool { id: id.into(), name: id.into(), items, unlocks_per_day: per_day, unlock_minutes: minutes, friction }
}

fn window(id: &str, start: &str, end: &str, locked: bool) -> ScheduleRule {
    ScheduleRule::Window { id: id.into(), days: Weekday::ALL.to_vec(), start: start.into(), end: end.into(), locked }
}

fn engine_with(profiles: Vec<(&str, ProfileConfig)>, ctx: &Ctx) -> Engine {
    let mut e = Engine::new(EngineState::new("dev"));
    for (id, config) in profiles {
        e.apply(Command::UpsertProfile { profile: input(id, config) }, Auth::None, ctx).unwrap();
    }
    e
}

fn on(e: &mut Engine, id: &str, ctx: &Ctx) {
    e.apply(Command::SetLatch { profile_id: id.into(), on: true }, Auth::None, ctx).unwrap();
}

fn err_code(r: Result<talysman_engine::Applied, talysman_engine::EngineError>) -> String {
    r.err().expect("expected an error").code
}

fn hard(e: &Engine, host: &str, ctx: &Ctx) -> bool {
    e.decide_host(host, ctx).verdict == Verdict::Hard
}

// --- §3.4 gating matrix ------------------------------------------------------------------------

#[test]
fn creating_duplicating_and_turning_on_are_free() {
    let ctx = at(10, 0);
    let mut e = engine_with(vec![("a", blocks(&["reddit.com"]))], &ctx);
    on(&mut e, "a", &ctx);
    e.apply(Command::DuplicateProfile { profile_id: "a".into(), new_id: "b".into(), color: Some("#fff".into()) }, Auth::None, &ctx).unwrap();
    let b = e.state.profile("b").unwrap();
    assert_eq!(b.name, "a copy");
    assert!(!b.latch.is_on());
    assert_eq!(b.config.policy.blocked_domains, vec!["reddit.com".to_string()]);
}

#[test]
fn turning_on_requires_a_paired_key() {
    let mut ctx = at(10, 0);
    let mut e = engine_with(vec![("a", blocks(&["reddit.com"]))], &ctx);
    ctx.has_paired_keys = false;
    assert_eq!(err_code(e.apply(Command::SetLatch { profile_id: "a".into(), on: true }, Auth::None, &ctx)), codes::NO_PAIRED_KEY);
}

#[test]
fn relaxing_an_active_profile_needs_the_key_and_breaks_the_streak() {
    let ctx = at(10, 0);
    let mut e = engine_with(vec![("a", blocks(&["reddit.com", "x.com"]))], &ctx);
    on(&mut e, "a", &ctx);
    let later = at(24 * 3 + 10, 0);
    e.tick(&later);
    assert_eq!(e.streak(&later).current_days, 3);
    let looser = Command::UpsertProfile { profile: input("a", blocks(&["reddit.com"])) };
    match e.gate(&looser, &later) {
        Gate::NeedsKey { relaxations, .. } => assert_eq!(relaxations, vec!["Unblocks x.com".to_string()]),
        other => panic!("{other:?}"),
    }
    assert_eq!(err_code(e.apply(looser.clone(), Auth::None, &later)), codes::KEY_REQUIRED);
    e.apply(looser, KEY(), &later).unwrap();
    assert_eq!(e.streak(&later).current_days, 0);
    // Tightening stays free and doesn't touch the streak.
    e.apply(Command::UpsertProfile { profile: input("a", blocks(&["reddit.com", "y.com"])) }, Auth::None, &later).unwrap();
}

#[test]
fn relaxing_a_dormant_unscheduled_profile_is_free_but_a_scheduled_one_is_not() {
    let ctx = at(10, 0);
    let mut e = engine_with(vec![("a", blocks(&["reddit.com"]))], &ctx);
    e.apply(Command::UpsertProfile { profile: input("a", blocks(&[])) }, Auth::None, &ctx).unwrap();
    let mut scheduled = blocks(&["reddit.com"]);
    scheduled.schedule.push(window("w", "20:00", "21:00", false));
    e.apply(Command::UpsertProfile { profile: input("a", scheduled.clone()) }, Auth::None, &ctx).unwrap();
    let mut looser = scheduled;
    looser.policy.blocked_domains.clear();
    assert!(matches!(e.gate(&Command::UpsertProfile { profile: input("a", looser) }, &ctx), Gate::NeedsKey { .. }));
}

#[test]
fn adding_an_off_rule_needs_the_key_but_fires_without_it() {
    let ctx = at(10, 0);
    let mut e = engine_with(vec![("a", blocks(&["reddit.com"]))], &ctx);
    on(&mut e, "a", &ctx);
    let mut with_off = blocks(&["reddit.com"]);
    with_off.one_shots.push(OneShotEvent { id: "o".into(), at_ms: at(12, 0).now.epoch_ms, action: OnOff::Off, fired_at_ms: None });
    let cmd = Command::UpsertProfile { profile: input("a", with_off) };
    assert_eq!(err_code(e.apply(cmd.clone(), Auth::None, &ctx)), codes::KEY_REQUIRED);
    e.apply(cmd, KEY(), &ctx).unwrap();
    assert!(hard(&e, "reddit.com", &at(11, 59)));
    let tick = e.tick(&at(12, 0));
    assert!(!tick.effective.active());
    assert!(e.state.profile("a").unwrap().config.one_shots[0].fired_at_ms.is_some());
}

#[test]
fn deleting_is_key_gated_only_when_committed_and_never_the_last_profile() {
    let ctx = at(10, 0);
    let mut e = engine_with(vec![("a", blocks(&[])), ("b", blocks(&[]))], &ctx);
    on(&mut e, "a", &ctx);
    assert!(matches!(e.gate(&Command::DeleteProfile { profile_id: "a".into() }, &ctx), Gate::NeedsKey { .. }));
    e.apply(Command::DeleteProfile { profile_id: "b".into() }, Auth::None, &ctx).unwrap();
    assert_eq!(err_code(e.apply(Command::DeleteProfile { profile_id: "a".into() }, KEY(), &ctx)), codes::LAST_PROFILE);
}

#[test]
fn pairing_needs_an_existing_key_only_while_something_is_active() {
    let ctx = at(10, 0);
    let mut e = engine_with(vec![("a", blocks(&["reddit.com"]))], &ctx);
    assert_eq!(e.gate(&Command::PairKey, &ctx), Gate::Free);
    on(&mut e, "a", &ctx);
    assert!(matches!(e.gate(&Command::PairKey, &ctx), Gate::NeedsKey { .. }));
    let mut first_key = ctx.clone();
    first_key.has_paired_keys = false;
    assert_eq!(e.gate(&Command::PairKey, &first_key), Gate::Free);
    assert!(matches!(e.gate(&Command::UnpairKey, &ctx), Gate::NeedsKey { .. }));
}

#[test]
fn profile_limits_apply_to_creation_and_duplication() {
    let mut ctx = at(10, 0);
    ctx.limits.max_profiles = Some(1);
    let mut e = engine_with(vec![("a", blocks(&[]))], &ctx);
    assert_eq!(err_code(e.apply(Command::UpsertProfile { profile: input("b", blocks(&[])) }, Auth::None, &ctx)), codes::LIMIT_EXCEEDED);
    assert_eq!(
        err_code(e.apply(Command::DuplicateProfile { profile_id: "a".into(), new_id: "b".into(), color: None }, Auth::None, &ctx)),
        codes::LIMIT_EXCEEDED
    );
}

// --- §3.5 overrides --------------------------------------------------------------------------

#[test]
fn override_all_off_restores_on_reenable_and_schedules_still_fire() {
    let ctx = at(10, 0);
    let mut a = blocks(&["reddit.com"]);
    a.schedule.push(window("w", "09:00", "11:00", false));
    a.schedule.push(ScheduleRule::At { id: "on".into(), days: Weekday::ALL.to_vec(), at: "13:00".into(), action: OnOff::On });
    let mut e = engine_with(vec![("a", a), ("b", blocks(&["x.com"]))], &ctx);
    on(&mut e, "b", &ctx);
    assert_eq!(err_code(e.apply(Command::StartOverrideAll, Auth::None, &ctx)), codes::KEY_REQUIRED);
    e.apply(Command::StartOverrideAll, KEY(), &ctx).unwrap();
    assert!(!e.effective(&ctx).active());
    assert!(e.snapshot(&ctx).overridden);
    assert_eq!(e.streak(&ctx).current_days, 0);
    // The suppressed window ends; the At-on rule still fires at 13:00.
    e.tick(&at(12, 0));
    assert!(!e.effective(&at(12, 0)).active());
    e.tick(&at(13, 0));
    assert_eq!(e.effective(&at(13, 0)).layers.iter().map(|l| l.profile_id.as_str()).collect::<Vec<_>>(), vec!["a"]);
    // Re-enable all brings back b's latch.
    e.apply(Command::ReenableAll, Auth::None, &at(13, 5)).unwrap();
    assert!(hard(&e, "x.com", &at(13, 5)));
    assert!(!e.snapshot(&at(13, 5)).overridden);
}

#[test]
fn override_exempt_items_stays_until_reenable_all() {
    let ctx = at(10, 0);
    let mut e = engine_with(vec![("a", blocks(&["reddit.com", "x.com"])), ("b", blocks(&["reddit.com"]))], &ctx);
    on(&mut e, "a", &ctx);
    on(&mut e, "b", &ctx);
    let cmd = Command::StartOverrideExempt { items: vec![ItemRef::Domain { domain: "reddit.com".into() }], profiles: vec![] };
    e.apply(cmd, KEY(), &ctx).unwrap();
    assert!(!hard(&e, "reddit.com", &ctx));
    assert!(hard(&e, "x.com", &ctx));
    e.tick(&at(30, 0));
    assert!(!hard(&e, "reddit.com", &at(30, 0)));
    e.apply(Command::ReenableAll, Auth::None, &at(30, 0)).unwrap();
    assert!(hard(&e, "reddit.com", &at(30, 0)));
}

#[test]
fn turning_one_profile_off_via_exempt_is_restored_by_reenable_all() {
    let ctx = at(10, 0);
    let mut e = engine_with(vec![("a", blocks(&["reddit.com"])), ("b", blocks(&["x.com"]))], &ctx);
    on(&mut e, "a", &ctx);
    on(&mut e, "b", &ctx);
    e.apply(Command::StartOverrideExempt { items: vec![], profiles: vec!["a".into()] }, KEY(), &ctx).unwrap();
    assert!(!hard(&e, "reddit.com", &ctx));
    assert!(hard(&e, "x.com", &ctx));
    e.apply(Command::ReenableAll, Auth::None, &ctx).unwrap();
    assert!(hard(&e, "reddit.com", &ctx));
}

#[test]
fn timed_override_resumes_by_itself() {
    let ctx = at(10, 0);
    let mut e = engine_with(vec![("a", blocks(&["reddit.com"]))], &ctx);
    on(&mut e, "a", &ctx);
    assert_eq!(err_code(e.apply(Command::StartOverrideTimed { minutes: 0 }, KEY(), &ctx)), codes::BAD_REQUEST);
    let applied = e.apply(Command::StartOverrideTimed { minutes: 30 }, KEY(), &ctx).unwrap();
    assert_eq!(applied.tick.effective.suspended_until_ms, Some(at(10, 30).now.epoch_ms));
    assert_eq!(applied.tick.next_wake_ms, at(10, 30).now.epoch_ms);
    assert!(!hard(&e, "reddit.com", &at(10, 29)));
    let tick = e.tick(&at(10, 30));
    assert!(tick.effective.active());
    assert!(e.state.overrides.timed.is_none());
}

#[test]
fn locked_windows_refuse_key_overrides_but_not_emergency() {
    let ctx = at(10, 0);
    let mut a = blocks(&["reddit.com"]);
    a.schedule.push(window("w", "09:00", "17:00", true));
    let mut e = engine_with(vec![("a", a), ("b", blocks(&["x.com"]))], &ctx);
    // Only the locked profile is active: nothing the key can do.
    assert!(matches!(e.gate(&Command::StartOverrideAll, &ctx), Gate::Locked { .. }));
    assert_eq!(err_code(e.apply(Command::StartOverrideAll, KEY(), &ctx)), codes::LOCKED);
    assert!(matches!(e.gate(&Command::StartOverrideTimed { minutes: 10 }, &ctx), Gate::Locked { .. }));
    // With another active profile the override applies to it and reports the locked one.
    on(&mut e, "b", &ctx);
    match e.gate(&Command::StartOverrideAll, &ctx) {
        Gate::NeedsKey { locked_profiles, .. } => assert_eq!(locked_profiles[0].profile_id, "a"),
        other => panic!("{other:?}"),
    }
    e.apply(Command::StartOverrideAll, KEY(), &ctx).unwrap();
    assert!(hard(&e, "reddit.com", &ctx));
    assert!(!hard(&e, "x.com", &ctx));
    // Relaxing the locked profile's config is Locked too.
    assert!(matches!(e.gate(&Command::UpsertProfile { profile: input("a", blocks(&[])) }, &ctx), Gate::Locked { .. }));
    // Emergency: everything off, locked window included, without a key.
    assert_eq!(e.emergency_left(), 5);
    e.apply(Command::EmergencyUnlock, Auth::None, &ctx).unwrap();
    assert!(!e.effective(&ctx).active());
    assert_eq!(e.emergency_left(), 4);
    // The bypass is for this occurrence only: tomorrow's window starts normally.
    e.tick(&at(17, 0));
    let tomorrow = at(24 + 9, 0);
    e.tick(&tomorrow);
    assert!(hard(&e, "reddit.com", &tomorrow));
}

#[test]
fn emergency_unlocks_run_out() {
    let ctx = at(10, 0);
    let mut e = engine_with(vec![("a", blocks(&["reddit.com"]))], &ctx);
    for _ in 0..EMERGENCY_LIFETIME_LIMIT {
        on(&mut e, "a", &ctx);
        e.apply(Command::EmergencyUnlock, Auth::None, &ctx).unwrap();
    }
    assert_eq!(e.emergency_left(), 0);
    assert_eq!(err_code(e.apply(Command::EmergencyUnlock, Auth::None, &ctx)), codes::NO_EMERGENCY_LEFT);
}

#[test]
fn turning_a_profile_off_suppresses_its_current_window_only() {
    let ctx = at(10, 0);
    let mut a = blocks(&["reddit.com"]);
    a.schedule.push(window("w", "09:00", "11:00", false));
    let mut e = engine_with(vec![("a", a)], &ctx);
    assert!(hard(&e, "reddit.com", &ctx));
    e.apply(Command::SetLatch { profile_id: "a".into(), on: false }, KEY(), &ctx).unwrap();
    assert!(!hard(&e, "reddit.com", &ctx));
    let tomorrow = at(24 + 9, 30);
    e.tick(&tomorrow);
    assert!(hard(&e, "reddit.com", &tomorrow));
}

// --- §3.6 pools ------------------------------------------------------------------------------

fn pooled_instagram(per_day: u8, friction: Friction) -> ProfileConfig {
    let mut c = ProfileConfig::default();
    c.policy.apps.push(instagram());
    c.policy.blocked_domains.push("instagram.com".into());
    c.pools.push(pool("social", vec![ItemRef::Catalog { id: "instagram".into() }], per_day, 10, friction));
    c
}

fn pool_ref(profile: &str, pool: &str) -> PoolRef {
    PoolRef { profile_id: profile.into(), pool_id: pool.into() }
}

#[test]
fn worked_example_3_pool_unlock_with_friction() {
    let ctx = at(10, 0);
    let mut e = engine_with(vec![("a", pooled_instagram(3, Friction::Breathing { secs: 15 }))], &ctx);
    on(&mut e, "a", &ctx);
    let popup = e.popup_info(&PopupTarget::App { app: instagram() }, &ctx);
    assert_eq!(popup.verdict, Verdict::Hard);
    assert!(popup.unlock_available);
    assert_eq!(popup.pools[0].left_today, 3);
    assert_eq!(popup.friction, Friction::Breathing { secs: 15 });
    assert_eq!(popup.blocking_profiles[0].id, "a");

    let pools = vec![pool_ref("a", "social")];
    assert_eq!(err_code(e.apply(Command::ConfirmPoolUnlock { pools: pools.clone() }, Auth::None, &ctx)), codes::FRICTION_PENDING);
    e.apply(Command::RequestPoolUnlock { pools: pools.clone() }, Auth::None, &ctx).unwrap();
    assert_eq!(err_code(e.apply(Command::ConfirmPoolUnlock { pools: pools.clone() }, Auth::None, &at(10, 0))), codes::FRICTION_PENDING);
    let ready = Ctx::new(ctx.now.epoch_ms + 15_000, 0, true);
    let applied = e.apply(Command::ConfirmPoolUnlock { pools: pools.clone() }, Auth::None, &ready).unwrap();
    assert_eq!(applied.journal.len(), 1);
    assert!(!applied.journal[0].breaks_streak);
    // Fully usable (hard and soft) for 10 minutes — web and app both.
    assert_eq!(e.decide_app(&instagram(), &ready).verdict, Verdict::Allow);
    assert!(!hard(&e, "www.instagram.com", &ready));
    let expired = Ctx::new(ready.now.epoch_ms + 10 * MINUTE_MS, 0, true);
    e.tick(&expired);
    assert_eq!(e.decide_app(&instagram(), &expired).verdict, Verdict::Hard);
    assert_eq!(e.popup_info(&PopupTarget::App { app: instagram() }, &expired).pools[0].left_today, 2);
}

#[test]
fn pools_run_out_and_reset_at_local_midnight() {
    let ctx = at(10, 0);
    let mut e = engine_with(vec![("a", pooled_instagram(1, Friction::None))], &ctx);
    on(&mut e, "a", &ctx);
    let pools = vec![pool_ref("a", "social")];
    e.apply(Command::RequestPoolUnlock { pools: pools.clone() }, Auth::None, &ctx).unwrap();
    assert_eq!(e.decide_app(&instagram(), &ctx).verdict, Verdict::Allow, "no friction unlocks immediately");
    assert_eq!(err_code(e.apply(Command::RequestPoolUnlock { pools: pools.clone() }, Auth::None, &at(11, 0))), codes::POOL_EXHAUSTED);
    assert!(!e.popup_info(&PopupTarget::App { app: instagram() }, &at(11, 0)).unlock_available);
    let tomorrow = at(24 + 1, 0);
    e.tick(&tomorrow);
    e.apply(Command::RequestPoolUnlock { pools }, Auth::None, &tomorrow).unwrap();
}

#[test]
fn pools_keep_working_inside_locked_windows() {
    let ctx = at(10, 0);
    let mut a = pooled_instagram(3, Friction::None);
    a.schedule.push(window("w", "09:00", "17:00", true));
    let mut e = engine_with(vec![("a", a)], &ctx);
    e.apply(Command::RequestPoolUnlock { pools: vec![pool_ref("a", "social")] }, Auth::None, &ctx).unwrap();
    assert_eq!(e.decide_app(&instagram(), &ctx).verdict, Verdict::Allow);
}

#[test]
fn worked_example_4_another_profile_without_a_pool_blocks_the_unlock() {
    let ctx = at(10, 0);
    let mut b = ProfileConfig::default();
    b.policy.apps.push(instagram());
    let mut e = engine_with(vec![("a", pooled_instagram(3, Friction::None)), ("b", b)], &ctx);
    on(&mut e, "a", &ctx);
    on(&mut e, "b", &ctx);
    let popup = e.popup_info(&PopupTarget::App { app: instagram() }, &ctx);
    assert_eq!(popup.unpooled_profiles, vec!["b".to_string()]);
    assert!(!popup.unlock_available);
    // Unlocking A's pool alone still leaves B's hard block.
    e.apply(Command::RequestPoolUnlock { pools: vec![pool_ref("a", "social")] }, Auth::None, &ctx).unwrap();
    assert_eq!(e.decide_app(&instagram(), &ctx).verdict, Verdict::Hard);
}

#[test]
fn worked_example_5_one_unlock_spends_from_every_blocking_pool() {
    let ctx = at(10, 0);
    let mut e = engine_with(vec![("a", pooled_instagram(3, Friction::None)), ("b", pooled_instagram(1, Friction::None))], &ctx);
    on(&mut e, "a", &ctx);
    on(&mut e, "b", &ctx);
    let popup = e.popup_info(&PopupTarget::App { app: instagram() }, &ctx);
    assert!(popup.unlock_available);
    let refs: Vec<PoolRef> = popup.pools.iter().map(|p| pool_ref(&p.profile_id, &p.pool_id)).collect();
    e.apply(Command::RequestPoolUnlock { pools: refs }, Auth::None, &ctx).unwrap();
    assert_eq!(e.decide_app(&instagram(), &ctx).verdict, Verdict::Allow);
    let later = at(11, 0);
    e.tick(&later);
    let popup = e.popup_info(&PopupTarget::App { app: instagram() }, &later);
    assert!(!popup.unlock_available, "b's single unlock is spent");
}

// --- §3.2 decision table ---------------------------------------------------------------------

#[test]
fn worked_example_1_hard_beats_soft_across_profiles() {
    let ctx = at(10, 0);
    let mut a = ProfileConfig::default();
    a.policy.apps.push(instagram());
    let mut b = ProfileConfig::default();
    b.policy.sites.insert("instagram".into(), SiteRule::default());
    let mut e = engine_with(vec![("a", a), ("b", b)], &ctx);
    on(&mut e, "a", &ctx);
    on(&mut e, "b", &ctx);
    assert_eq!(e.decide_app(&instagram(), &ctx).verdict, Verdict::Hard);
}

#[test]
fn worked_example_2_app_whitelist_with_a_soft_rule() {
    let ctx = at(10, 0);
    let mut a = ProfileConfig { app_mode: BlockMode::Whitelist, ..Default::default() };
    a.allowed_apps.push(AppRef { android_package: Some("com.spotify.music".into()), label: "Spotify".into(), ..Default::default() });
    a.policy.sites.insert("youtube".into(), SiteRule { features: [("shorts".to_string(), RuleAction::Block)].into() });
    let mut e = engine_with(vec![("a", a)], &ctx);
    on(&mut e, "a", &ctx);
    let youtube = AppRef { android_package: Some("com.google.android.youtube".into()), label: "YouTube".into(), ..Default::default() };
    assert!(matches!(e.decide_app(&youtube, &ctx).verdict, Verdict::Soft { .. }));
    let spotify = AppRef { android_package: Some("com.spotify.music".into()), label: "Spotify".into(), ..Default::default() };
    assert_eq!(e.decide_app(&spotify, &ctx).verdict, Verdict::Allow);
    let game = AppRef { android_package: Some("com.example.game".into()), label: "Game".into(), ..Default::default() };
    assert_eq!(e.decide_app(&game, &ctx).verdict, Verdict::Hard);
}

// --- §3.9 schedules --------------------------------------------------------------------------

#[test]
fn at_rules_flip_the_latch_and_replay_after_downtime() {
    let ctx = at(8, 0);
    let mut a = blocks(&["reddit.com"]);
    a.schedule.push(ScheduleRule::At { id: "on".into(), days: Weekday::ALL.to_vec(), at: "09:00".into(), action: OnOff::On });
    a.schedule.push(ScheduleRule::At { id: "off".into(), days: Weekday::ALL.to_vec(), at: "17:00".into(), action: OnOff::Off });
    let mut e = engine_with(vec![("a", a)], &ctx);
    let tick = e.tick(&ctx);
    assert_eq!(tick.next_wake_ms, at(9, 0).now.epoch_ms);
    e.tick(&at(9, 0));
    assert!(hard(&e, "reddit.com", &at(9, 0)));
    // Device off from 16:00 to 18:00: the 17:00 "off" is replayed.
    e.tick(&at(16, 0));
    e.tick(&at(18, 0));
    assert!(!hard(&e, "reddit.com", &at(18, 0)));
}

#[test]
fn an_off_rule_cannot_end_a_window() {
    let ctx = at(8, 0);
    let mut a = blocks(&["reddit.com"]);
    a.schedule.push(window("w", "09:00", "17:00", false));
    a.schedule.push(ScheduleRule::At { id: "off".into(), days: Weekday::ALL.to_vec(), at: "12:00".into(), action: OnOff::Off });
    let mut e = engine_with(vec![("a", a)], &ctx);
    e.tick(&at(11, 0));
    e.tick(&at(12, 30));
    assert!(hard(&e, "reddit.com", &at(12, 30)));
}

#[test]
fn several_profiles_can_be_active_at_once() {
    let ctx = at(10, 0);
    let mut a = blocks(&["reddit.com"]);
    a.schedule.push(window("w", "09:00", "17:00", false));
    let mut b = blocks(&["x.com"]);
    b.schedule.push(window("w", "10:00", "11:00", false));
    let mut e = engine_with(vec![("a", a), ("b", b)], &ctx);
    let tick = e.tick(&ctx);
    assert_eq!(tick.effective.layers.len(), 2);
    assert!(hard(&e, "reddit.com", &ctx) && hard(&e, "x.com", &ctx));
    let flat = e.network_policy(&ctx);
    assert_eq!(flat.blocked_domains, vec!["reddit.com".to_string(), "x.com".to_string()]);
}

#[test]
fn generation_bumps_when_enforcement_changes() {
    let ctx = at(10, 0);
    let mut e = engine_with(vec![("a", blocks(&["reddit.com"]))], &ctx);
    let g0 = e.tick(&ctx).effective.generation;
    on(&mut e, "a", &ctx);
    let g1 = e.tick(&ctx).effective.generation;
    assert!(g1 > g0);
    assert_eq!(e.tick(&ctx).effective.generation, g1);
}

#[test]
fn state_round_trips_through_json() {
    let ctx = at(10, 0);
    let mut e = engine_with(vec![("a", pooled_instagram(3, Friction::Countdown { secs: 5 }))], &ctx);
    on(&mut e, "a", &ctx);
    e.apply(Command::RequestPoolUnlock { pools: vec![pool_ref("a", "social")] }, Auth::None, &ctx).unwrap();
    let json = e.export();
    let back = Engine::load(&json).unwrap();
    assert_eq!(back.state, e.state);
    let snap = serde_json::to_value(e.snapshot(&ctx)).unwrap();
    assert_eq!(snap["pools"][0]["leftToday"], 3);
    assert_eq!(snap["pendingUnlocks"].as_array().unwrap().len(), 1);
    assert_eq!(snap["profiles"][0]["profile"]["latch"]["state"], "on");
}
