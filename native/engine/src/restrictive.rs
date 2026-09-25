//! Is a profile-config edit a relaxation? Relaxations of a committed profile (active, or able to
//! become active through its schedule) need the key and break the streak; tightening is free.
//!
//! Replaces packages/core/src/restrictiveness.ts and the v5 schedule comparison. The policy part
//! is still `policy_match::is_at_least_as_restrictive`; this adds app whitelists, pools,
//! schedules, and one-shots, and itemizes what was loosened for the UI ("Removing reddit.com from
//! your block list needs your key").

use crate::model::{BlockMode, OnOff, Pool, ProfileConfig, ScheduleRule};
use crate::policy::Policy;
use crate::policy_match::{host_matches, is_at_least_as_restrictive, is_host_blocked, same_app};
use crate::schedule::weekly_coverage;
use crate::site_catalog;

fn policy_relaxations(prev: &Policy, next: &Policy) -> Vec<String> {
    let mut out = Vec::new();
    for pattern in &prev.blocked_domains {
        let base = pattern.trim().trim_start_matches("*.").to_ascii_lowercase();
        if is_host_blocked(prev, &base) && !is_host_blocked(next, &base) {
            out.push(format!("Unblocks {base}"));
        }
    }
    for pattern in &next.allowed_domains {
        let base = pattern.trim().trim_start_matches("*.").to_ascii_lowercase();
        if is_host_blocked(prev, &base) && !is_host_blocked(next, &base) && !out.iter().any(|m| m.ends_with(&base)) {
            out.push(format!("Allows {base}"));
        }
    }
    for app in &prev.apps {
        if !next.apps.iter().any(|a| same_app(a, app)) {
            out.push(format!("Unblocks the {} app", app.label));
        }
    }
    for (site, rule) in prev.catalog_sites() {
        let hard = site
            .hosts
            .first()
            .is_some_and(|host| next.blocked_domains.iter().any(|d| host_matches(host, d)));
        if hard {
            continue;
        }
        let label = if site.label.is_empty() { site.id.clone() } else { site.label.clone() };
        match next.sites.get(&site.id) {
            None => out.push(format!("Removes the {label} soft block")),
            Some(after) if !site.at_least_as_restrictive(Some(rule), Some(after)) => {
                out.push(format!("Loosens the {label} soft block"))
            }
            _ => {}
        }
    }
    if next.default_action.rank() < prev.default_action.rank() {
        out.push("Loosens the default for other websites".into());
    }
    if prev.judge.is_some() && next.judge.is_none() && prev.uses_judge() {
        out.push("Removes AI filtering".into());
    }
    for list in &prev.enabled_premade_lists {
        if !next.enabled_premade_lists.contains(list) {
            out.push(format!("Turns off the {list:?} list"));
        }
    }
    if out.is_empty() && !is_at_least_as_restrictive(prev, next) {
        out.push("Loosens website rules".into());
    }
    out
}

fn friction_weaker(prev: &Pool, next: &Pool) -> bool {
    next.friction.secs() < prev.friction.secs()
}

fn pool_relaxations(prev: &[Pool], next: &[Pool]) -> Vec<String> {
    let mut out = Vec::new();
    for pool in next {
        match prev.iter().find(|p| p.id == pool.id) {
            None => {
                if pool.unlocks_per_day > 0 && !pool.items.is_empty() {
                    out.push(format!("Adds the {} pool", pool.name));
                }
            }
            Some(before) => {
                if pool.items.iter().any(|item| !before.items.contains(item)) && pool.unlocks_per_day > 0 {
                    out.push(format!("Adds items to the {} pool", pool.name));
                }
                if pool.unlocks_per_day > before.unlocks_per_day {
                    out.push(format!("Raises {} unlocks per day", pool.name));
                }
                if pool.unlock_minutes > before.unlock_minutes {
                    out.push(format!("Lengthens {} unlocks", pool.name));
                }
                if friction_weaker(before, pool) {
                    out.push(format!("Shortens the {} pause", pool.name));
                }
            }
        }
    }
    out
}

fn schedule_relaxations(prev: &[ScheduleRule], next: &[ScheduleRule]) -> Vec<String> {
    let mut out = Vec::new();
    let (prev_cov, prev_locked) = weekly_coverage(prev);
    let (next_cov, next_locked) = weekly_coverage(next);
    if prev_cov.iter().zip(&next_cov).any(|(p, n)| *p && !*n) {
        out.push("Shortens or removes a scheduled window".into());
    }
    if prev_locked.iter().zip(&next_locked).any(|(p, n)| *p && !*n) {
        out.push("Unlocks a locked window".into());
    }
    let ats = |rules: &[ScheduleRule], action: OnOff| -> Vec<ScheduleRule> {
        rules
            .iter()
            .filter(|r| matches!(r, ScheduleRule::At { action: a, .. } if *a == action))
            .cloned()
            .map(|r| match r {
                // Identity is when it fires, not its id.
                ScheduleRule::At { days, at, action, .. } => {
                    let mut days = days;
                    days.sort();
                    ScheduleRule::At { id: String::new(), days, at, action }
                }
                other => other,
            })
            .collect()
    };
    let (prev_off, next_off) = (ats(prev, OnOff::Off), ats(next, OnOff::Off));
    if next_off.iter().any(|r| !prev_off.contains(r)) {
        out.push("Adds a scheduled \"off\"".into());
    }
    let (prev_on, next_on) = (ats(prev, OnOff::On), ats(next, OnOff::On));
    if prev_on.iter().any(|r| !next_on.contains(r)) {
        out.push("Removes a scheduled \"on\"".into());
    }
    out
}

/// Every way `next` is looser than `prev`. Empty ⇔ `next` is at least as restrictive.
pub fn relaxations(prev: &ProfileConfig, next: &ProfileConfig, now_ms: i64) -> Vec<String> {
    let mut out = policy_relaxations(&prev.policy, &next.policy);

    if prev.app_mode == BlockMode::Whitelist {
        if next.app_mode == BlockMode::Blacklist {
            out.push("Switches apps from allow-list to block-list".into());
        } else {
            for app in &next.allowed_apps {
                if !prev.allowed_apps.iter().any(|a| same_app(a, app)) {
                    out.push(format!("Allows the {} app", app.label));
                }
            }
        }
    }

    out.extend(pool_relaxations(&prev.pools, &next.pools));
    out.extend(schedule_relaxations(&prev.schedule, &next.schedule));

    let pending = |c: &ProfileConfig, action: OnOff| -> Vec<(i64, OnOff)> {
        c.one_shots
            .iter()
            .filter(|e| e.fired_at_ms.is_none() && e.at_ms > now_ms && e.action == action)
            .map(|e| (e.at_ms, e.action))
            .collect()
    };
    if pending(next, OnOff::Off).iter().any(|e| !pending(prev, OnOff::Off).contains(e)) {
        out.push("Adds a one-time \"off\"".into());
    }
    if pending(prev, OnOff::On).iter().any(|e| !pending(next, OnOff::On).contains(e)) {
        out.push("Removes a one-time \"on\"".into());
    }
    out
}

/// Validation applied to configs arriving from a UI (never to persisted state).
pub fn validate(config: &ProfileConfig) -> Result<(), String> {
    use crate::model::*;
    config.policy.validate()?;
    let mut seen: Vec<&ItemRef> = Vec::new();
    for pool in &config.pools {
        if pool.name.trim().is_empty() {
            return Err("Pool names cannot be empty.".into());
        }
        if pool.unlocks_per_day > MAX_POOL_UNLOCKS_PER_DAY {
            return Err(format!("Pools allow at most {MAX_POOL_UNLOCKS_PER_DAY} unlocks a day."));
        }
        if pool.unlock_minutes == 0 || pool.unlock_minutes > MAX_POOL_UNLOCK_MINUTES {
            return Err(format!("Pool unlocks last 1–{MAX_POOL_UNLOCK_MINUTES} minutes."));
        }
        if pool.friction.secs() > MAX_FRICTION_SECS {
            return Err(format!("Pauses are at most {MAX_FRICTION_SECS} seconds."));
        }
        for item in &pool.items {
            if seen.contains(&item) {
                return Err(format!("POOL_ITEM_CONFLICT: an item can be in only one pool ({item:?})."));
            }
            if let ItemRef::Catalog { id } = item {
                if site_catalog::site(id).is_none() {
                    return Err(format!("Unknown catalog entry: {id}"));
                }
            }
            seen.push(item);
        }
    }
    let mut ids: Vec<&str> = config.pools.iter().map(|p| p.id.as_str()).collect();
    ids.extend(config.schedule.iter().map(|r| r.id()));
    ids.extend(config.one_shots.iter().map(|e| e.id.as_str()));
    let count = ids.len();
    ids.sort();
    ids.dedup();
    if ids.len() != count || ids.iter().any(|id| id.is_empty()) {
        return Err("Pool, schedule and event ids must be unique and non-empty.".into());
    }
    for rule in &config.schedule {
        let times: Vec<&String> = match rule {
            ScheduleRule::Window { start, end, .. } => vec![start, end],
            ScheduleRule::At { at, .. } => vec![at],
        };
        if times.iter().any(|t| crate::time::parse_hm(t).is_none()) {
            return Err("Schedule times must be HH:MM.".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;
    use crate::policy::RuleAction;
    use crate::time::Weekday;

    fn config() -> ProfileConfig {
        let mut c = ProfileConfig::default();
        c.policy.blocked_domains = vec!["reddit.com".into()];
        c.pools = vec![Pool {
            id: "p".into(),
            name: "Social".into(),
            items: vec![ItemRef::Domain { domain: "reddit.com".into() }],
            unlocks_per_day: 3,
            unlock_minutes: 10,
            friction: Friction::Countdown { secs: 15 },
        }];
        c.schedule = vec![
            ScheduleRule::Window { id: "w".into(), days: vec![Weekday::Mon], start: "09:00".into(), end: "17:00".into(), locked: true },
            ScheduleRule::At { id: "a".into(), days: vec![Weekday::Tue], at: "09:00".into(), action: OnOff::On },
        ];
        c
    }

    #[test]
    fn identical_configs_have_no_relaxations() {
        assert!(relaxations(&config(), &config(), 0).is_empty());
    }

    #[test]
    fn tightening_is_free() {
        let mut next = config();
        next.policy.blocked_domains.push("x.com".into());
        next.pools[0].unlocks_per_day = 1;
        next.pools[0].unlock_minutes = 5;
        next.pools[0].friction = Friction::Breathing { secs: 30 };
        next.policy.default_action = RuleAction::Block;
        next.one_shots.push(OneShotEvent { id: "o".into(), at_ms: 100, action: OnOff::On, fired_at_ms: None });
        assert_eq!(relaxations(&config(), &next, 0), Vec::<String>::new());
        let mut removed_pool = config();
        removed_pool.pools.clear();
        assert!(relaxations(&config(), &removed_pool, 0).is_empty());
    }

    #[test]
    fn every_kind_of_loosening_is_reported() {
        let base = config();
        let check = |edit: &dyn Fn(&mut ProfileConfig)| {
            let mut next = base.clone();
            edit(&mut next);
            assert!(!relaxations(&base, &next, 0).is_empty());
        };
        check(&|c| c.policy.blocked_domains.clear());
        check(&|c| c.pools[0].unlocks_per_day = 4);
        check(&|c| c.pools[0].unlock_minutes = 11);
        check(&|c| c.pools[0].friction = Friction::None);
        check(&|c| c.pools[0].items.push(ItemRef::Domain { domain: "x.com".into() }));
        check(&|c| {
            c.pools.push(Pool { id: "q".into(), name: "More".into(), items: vec![ItemRef::Domain { domain: "y.com".into() }], unlocks_per_day: 1, unlock_minutes: 1, friction: Friction::None })
        });
        check(&|c| { c.schedule.remove(0); });
        check(&|c| if let ScheduleRule::Window { locked, .. } = &mut c.schedule[0] { *locked = false });
        check(&|c| if let ScheduleRule::Window { start, .. } = &mut c.schedule[0] { *start = "10:00".into() });
        check(&|c| c.schedule.push(ScheduleRule::At { id: "off".into(), days: vec![Weekday::Mon], at: "12:00".into(), action: OnOff::Off }));
        check(&|c| { c.schedule.remove(1); });
        check(&|c| c.one_shots.push(OneShotEvent { id: "o".into(), at_ms: 100, action: OnOff::Off, fired_at_ms: None }));
    }

    #[test]
    fn app_whitelist_loosening() {
        let mut prev = config();
        prev.app_mode = BlockMode::Whitelist;
        let mut next = prev.clone();
        next.allowed_apps.push(crate::policy::AppRef { android_package: Some("a.b".into()), label: "B".into(), ..Default::default() });
        assert!(!relaxations(&prev, &next, 0).is_empty());
        assert!(relaxations(&next, &prev, 0).is_empty());
        let mut blacklist = prev.clone();
        blacklist.app_mode = BlockMode::Blacklist;
        assert!(!relaxations(&prev, &blacklist, 0).is_empty());
    }

    #[test]
    fn an_item_may_be_in_only_one_pool() {
        let mut c = config();
        let mut second = c.pools[0].clone();
        second.id = "q".into();
        c.pools.push(second);
        assert!(validate(&c).unwrap_err().starts_with("POOL_ITEM_CONFLICT"));
    }
}
