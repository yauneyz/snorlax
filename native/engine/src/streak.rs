//! Per-profile streaks and emergency-unlock accounting. Emergency unlocks are a pure function of
//! the journal (and the clock); streaks are runs kept in [`EngineState::streaks`], so a profile
//! kept on for good accumulates its own streak while another is toggled freely.

use serde::{Deserialize, Serialize};

use crate::model::{EngineState, JournalKind, ProfileStreak, EMERGENCY_REFILL_MS, EMERGENCY_UNLOCK_CAP};
use crate::time::{parse_date, LocalNow};

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Streak {
    /// The profile this streak belongs to; `None` when no profile has one.
    pub profile_id: Option<String>,
    /// Whole local days since the run started (0 on the day of a break, or while the profile
    /// isn't committed).
    pub current_days: u32,
    pub best_days: u32,
    pub last_break_local_date: Option<String>,
}

fn days_between(from: &str, to_day: i64) -> u32 {
    parse_date(from).map_or(0, |d| (to_day - d).max(0) as u32)
}

pub fn profile_streak(state: &EngineState, profile_id: &str, now: &LocalNow) -> Streak {
    let Some(run) = state.streaks.iter().find(|s| s.profile_id == profile_id) else {
        return Streak { profile_id: Some(profile_id.to_string()), ..Streak::default() };
    };
    let current = run.since_local_date.as_deref().map_or(0, |since| days_between(since, now.day()));
    Streak {
        profile_id: Some(profile_id.to_string()),
        current_days: current,
        best_days: run.best_days.max(current),
        last_break_local_date: run.last_break_local_date.clone(),
    }
}

/// The longest current streak among `profile_ids` (the headline badge).
pub fn longest<'a>(state: &EngineState, profile_ids: impl IntoIterator<Item = &'a str>, now: &LocalNow) -> Streak {
    profile_ids
        .into_iter()
        .map(|id| profile_streak(state, id, now))
        .max_by_key(|s| (s.current_days, s.best_days))
        .unwrap_or_default()
}

fn run_mut<'a>(state: &'a mut EngineState, profile_id: &str) -> &'a mut ProfileStreak {
    match state.streaks.iter().position(|s| s.profile_id == profile_id) {
        Some(i) => &mut state.streaks[i],
        None => {
            state.streaks.push(ProfileStreak { profile_id: profile_id.to_string(), ..ProfileStreak::default() });
            state.streaks.last_mut().unwrap()
        }
    }
}

fn finish(run: &mut ProfileStreak, now: &LocalNow) {
    if let Some(since) = run.since_local_date.take() {
        run.best_days = run.best_days.max(days_between(&since, now.day()));
    }
}

/// A break: each profile's run restarts today.
pub fn break_runs(state: &mut EngineState, profile_ids: &[String], now: &LocalNow) {
    for id in profile_ids {
        let run = run_mut(state, id);
        finish(run, now);
        run.since_local_date = Some(now.date_string());
        run.last_break_local_date = Some(now.date_string());
    }
}

/// Start runs for newly committed profiles and end those of profiles no longer committed.
pub fn update_runs(state: &mut EngineState, committed: &[(String, bool)], now: &LocalNow) {
    if !state.streaks_seeded {
        seed_from_device_streak(state, committed);
    }
    for (id, is_committed) in committed {
        if *is_committed {
            let run = run_mut(state, id);
            if run.since_local_date.is_none() {
                run.since_local_date = Some(now.date_string());
            }
        } else if let Some(run) = state.streaks.iter_mut().find(|s| s.profile_id == *id) {
            finish(run, now);
        }
    }
    state.streaks.retain(|s| committed.iter().any(|(id, _)| *id == s.profile_id));
}

/// State from before streaks were per profile had one device-wide streak, counted from the first
/// day any profile was active to the last breaking journal entry. Profiles committed at upgrade
/// carry it on.
fn seed_from_device_streak(state: &mut EngineState, committed: &[(String, bool)]) {
    state.streaks_seeded = true;
    let mut breaks: Vec<i64> = state.journal.iter().filter(|e| e.breaks_streak).filter_map(|e| parse_date(&e.local_date)).collect();
    breaks.sort();
    breaks.dedup();
    let start = state.first_enabled_local_date.as_deref().and_then(parse_date);
    let Some(anchor) = breaks.last().copied().or(start) else { return };
    let mut best = 0;
    let mut previous = start;
    for day in &breaks {
        if let Some(prev) = previous {
            best = best.max((day - prev).max(0) as u32);
        }
        previous = Some(*day);
    }
    for (id, is_committed) in committed {
        if *is_committed && !state.streaks.iter().any(|s| s.profile_id == *id) {
            state.streaks.push(ProfileStreak {
                profile_id: id.clone(),
                since_local_date: Some(crate::time::date_string(anchor)),
                best_days: best,
                last_break_local_date: breaks.last().map(|d| crate::time::date_string(*d)),
            });
        }
    }
}

/// Emergency unlocks work like a token bucket: it holds up to [`EMERGENCY_UNLOCK_CAP`], and while
/// it's below the cap one comes back every [`EMERGENCY_REFILL_MS`], timed from the first use that
/// dropped it below the cap.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EmergencyBudget {
    pub left: u8,
    /// When the next one comes back; `None` while the bucket is full.
    pub refill_at_ms: Option<i64>,
}

pub fn emergency_budget(state: &EngineState, now_ms: i64) -> EmergencyBudget {
    let mut uses: Vec<i64> = state.journal.iter().filter(|e| matches!(e.kind, JournalKind::EmergencyUsed)).map(|e| e.at_ms).collect();
    uses.sort();
    let mut left = EMERGENCY_UNLOCK_CAP;
    // Start of the refill period in progress; `None` while full.
    let mut anchor: Option<i64> = None;
    let refill = |left: &mut u8, anchor: &mut Option<i64>, t: i64| {
        let Some(a) = *anchor else { return };
        let earned = ((t - a).max(0) / EMERGENCY_REFILL_MS).min(EMERGENCY_UNLOCK_CAP as i64) as u8;
        *left = (*left + earned).min(EMERGENCY_UNLOCK_CAP);
        *anchor = if *left == EMERGENCY_UNLOCK_CAP { None } else { Some(a + earned as i64 * EMERGENCY_REFILL_MS) };
    };
    for t in uses {
        refill(&mut left, &mut anchor, t);
        // Merged journals could hold more uses than the bucket allowed; never go negative.
        left = left.saturating_sub(1);
        anchor.get_or_insert(t);
    }
    refill(&mut left, &mut anchor, now_ms);
    EmergencyBudget { left, refill_at_ms: anchor.map(|a| a + EMERGENCY_REFILL_MS) }
}

pub fn emergency_left(state: &EngineState, now_ms: i64) -> u8 {
    emergency_budget(state, now_ms).left
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::JournalEntry;
    use crate::time::{days_from_civil, DAY_MS};

    fn entry(date: &str, breaks: bool, kind: JournalKind) -> JournalEntry {
        JournalEntry { id: date.into(), device_id: "d".into(), seq: 0, at_ms: 0, local_date: date.into(), breaks_streak: breaks, kind }
    }

    fn used_at(at_ms: i64) -> JournalEntry {
        JournalEntry { id: at_ms.to_string(), device_id: "d".into(), seq: 0, at_ms, local_date: "2026-01-01".into(), breaks_streak: true, kind: JournalKind::EmergencyUsed }
    }

    fn on(date: &str) -> LocalNow {
        LocalNow::new(parse_date(date).unwrap() * DAY_MS + 3_600_000, 0)
    }

    fn committed(ids: &[(&str, bool)]) -> Vec<(String, bool)> {
        ids.iter().map(|(id, c)| (id.to_string(), *c)).collect()
    }

    fn seeded() -> EngineState {
        let mut s = EngineState::new("d");
        s.streaks_seeded = true;
        s
    }

    #[test]
    fn no_history_means_no_streak() {
        let s = seeded();
        assert_eq!(profile_streak(&s, "a", &on("2026-09-24")).current_days, 0);
        assert_eq!(longest(&s, [], &on("2026-09-24")), Streak::default());
    }

    #[test]
    fn each_profile_keeps_its_own_run() {
        let mut s = seeded();
        update_runs(&mut s, &committed(&[("keep", true), ("toggle", true)]), &on("2026-09-01"));
        // Turning "toggle" off ends only its run.
        update_runs(&mut s, &committed(&[("keep", true), ("toggle", false)]), &on("2026-09-05"));
        assert_eq!(profile_streak(&s, "toggle", &on("2026-09-24")).current_days, 0);
        assert_eq!(profile_streak(&s, "toggle", &on("2026-09-24")).best_days, 4);
        assert_eq!(profile_streak(&s, "keep", &on("2026-09-24")).current_days, 23);
        // Back on later: a fresh run from that day, not from the old start.
        update_runs(&mut s, &committed(&[("keep", true), ("toggle", true)]), &on("2026-09-20"));
        assert_eq!(profile_streak(&s, "toggle", &on("2026-09-24")).current_days, 4);
        // A break on "toggle" leaves "keep" alone.
        break_runs(&mut s, &["toggle".into()], &on("2026-09-24"));
        let toggle = profile_streak(&s, "toggle", &on("2026-09-24"));
        assert_eq!((toggle.current_days, toggle.best_days), (0, 4));
        assert_eq!(toggle.last_break_local_date.as_deref(), Some("2026-09-24"));
        let headline = longest(&s, ["keep", "toggle"], &on("2026-09-24"));
        assert_eq!((headline.profile_id.as_deref(), headline.current_days), (Some("keep"), 23));
    }

    #[test]
    fn deleted_profiles_drop_their_runs() {
        let mut s = seeded();
        update_runs(&mut s, &committed(&[("a", true), ("b", true)]), &on("2026-09-01"));
        update_runs(&mut s, &committed(&[("a", true)]), &on("2026-09-02"));
        assert_eq!(s.streaks.len(), 1);
    }

    #[test]
    fn upgrade_carries_the_device_streak_onto_committed_profiles() {
        let mut s = EngineState::new("d");
        s.first_enabled_local_date = Some("2026-01-01".into());
        s.journal.push(entry("2026-03-01", true, JournalKind::ReenabledAll));
        s.journal.push(entry("2026-03-05", true, JournalKind::ReenabledAll));
        s.journal.push(entry("2026-03-06", false, JournalKind::KeyPaired));
        update_runs(&mut s, &committed(&[("on", true), ("off", false)]), &on("2026-03-07"));
        let st = profile_streak(&s, "on", &on("2026-03-07"));
        assert_eq!((st.current_days, st.best_days), (2, 59));
        assert_eq!(st.last_break_local_date.as_deref(), Some("2026-03-05"));
        assert_eq!(profile_streak(&s, "off", &on("2026-03-07")).current_days, 0);
        // Seeding happens once; a profile committed later starts from that day.
        update_runs(&mut s, &committed(&[("on", true), ("off", true)]), &on("2026-03-10"));
        assert_eq!(profile_streak(&s, "off", &on("2026-03-12")).current_days, 2);
        assert_eq!(emergency_left(&s, 0), EMERGENCY_UNLOCK_CAP);
        assert_eq!(days_from_civil(2026, 3, 5), parse_date("2026-03-05").unwrap());
    }

    #[test]
    fn emergency_unlocks_refill_one_per_period_up_to_the_cap() {
        let m = EMERGENCY_REFILL_MS;
        let mut s = EngineState::new("d");
        assert_eq!(emergency_budget(&s, 0), EmergencyBudget { left: EMERGENCY_UNLOCK_CAP, refill_at_ms: None });
        // Two uses ten days apart: the refill clock runs from the first.
        s.journal.push(used_at(1_000));
        s.journal.push(used_at(1_000 + 10 * DAY_MS));
        assert_eq!(emergency_budget(&s, 2 * DAY_MS * 10), EmergencyBudget { left: 3, refill_at_ms: Some(1_000 + m) });
        assert_eq!(emergency_budget(&s, 1_000 + m), EmergencyBudget { left: 4, refill_at_ms: Some(1_000 + 2 * m) });
        assert_eq!(emergency_budget(&s, 1_000 + 2 * m), EmergencyBudget { left: 5, refill_at_ms: None });
        // Long after, the bucket is simply full.
        assert_eq!(emergency_left(&s, 1_000 + 50 * m), EMERGENCY_UNLOCK_CAP);
    }

    #[test]
    fn spending_everything_waits_for_the_next_refill() {
        let m = EMERGENCY_REFILL_MS;
        let mut s = EngineState::new("d");
        for i in 0..EMERGENCY_UNLOCK_CAP as i64 {
            s.journal.push(used_at(i * DAY_MS));
        }
        assert_eq!(emergency_budget(&s, 5 * DAY_MS), EmergencyBudget { left: 0, refill_at_ms: Some(m) });
        assert_eq!(emergency_left(&s, m - 1), 0);
        assert_eq!(emergency_left(&s, m), 1);
        // Spending the refilled one restarts nothing: the next is still one period after the last.
        s.journal.push(used_at(m + DAY_MS));
        assert_eq!(emergency_budget(&s, m + DAY_MS), EmergencyBudget { left: 0, refill_at_ms: Some(2 * m) });
        // A full bucket regained after a gap starts a fresh clock on the next use.
        s.journal.push(used_at(20 * m));
        assert_eq!(emergency_budget(&s, 20 * m), EmergencyBudget { left: 4, refill_at_ms: Some(21 * m) });
    }
}
