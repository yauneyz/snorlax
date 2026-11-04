//! Streak and emergency-unlock accounting. Both are pure functions of the journal (and the clock),
//! so merging journals from several devices (a future account sync) yields the right numbers for free.

use serde::{Deserialize, Serialize};

use crate::model::{EngineState, JournalKind, EMERGENCY_REFILL_MS, EMERGENCY_UNLOCK_CAP};
use crate::time::{parse_date, LocalNow};

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Streak {
    /// Whole local days since the last breaking event (0 on the day of a break). Counted from the
    /// first day a profile was active until the first break; 0 before that.
    pub current_days: u32,
    pub best_days: u32,
    pub last_break_local_date: Option<String>,
}

pub fn streak(state: &EngineState, now: &LocalNow) -> Streak {
    let today = now.day();
    let mut breaks: Vec<i64> = state
        .journal
        .iter()
        .filter(|e| e.breaks_streak)
        .filter_map(|e| parse_date(&e.local_date))
        .collect();
    breaks.sort();
    breaks.dedup();
    let start = state.first_enabled_local_date.as_deref().and_then(parse_date);
    let Some(anchor) = breaks.last().copied().or(start) else {
        return Streak::default();
    };
    let current = (today - anchor).max(0) as u32;
    let mut best = current;
    let mut previous = start;
    for day in &breaks {
        if let Some(prev) = previous {
            best = best.max((day - prev).max(0) as u32);
        }
        previous = Some(*day);
    }
    Streak {
        current_days: current,
        best_days: best,
        last_break_local_date: breaks.last().map(|d| crate::time::date_string(*d)),
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

    #[test]
    fn no_history_means_no_streak() {
        assert_eq!(streak(&EngineState::new("d"), &on("2026-09-24")), Streak::default());
    }

    #[test]
    fn counts_from_first_enable_then_from_the_last_break() {
        let mut s = EngineState::new("d");
        s.first_enabled_local_date = Some("2026-09-01".into());
        assert_eq!(streak(&s, &on("2026-09-24")).current_days, 23);
        s.journal.push(entry("2026-09-10", true, JournalKind::EmergencyUsed));
        s.journal.push(entry("2026-09-12", false, JournalKind::KeyPaired));
        let st = streak(&s, &on("2026-09-24"));
        assert_eq!(st.current_days, 14);
        assert_eq!(st.best_days, 14);
        assert_eq!(st.last_break_local_date.as_deref(), Some("2026-09-10"));
        assert_eq!(streak(&s, &on("2026-09-10")).current_days, 0);
        assert_eq!(emergency_left(&s, 0), EMERGENCY_UNLOCK_CAP - 1);
        assert_eq!(days_from_civil(2026, 9, 10), parse_date("2026-09-10").unwrap());
    }

    #[test]
    fn best_remembers_an_earlier_longer_run() {
        let mut s = EngineState::new("d");
        s.first_enabled_local_date = Some("2026-01-01".into());
        s.journal.push(entry("2026-03-01", true, JournalKind::ReenabledAll));
        s.journal.push(entry("2026-03-05", true, JournalKind::ReenabledAll));
        let st = streak(&s, &on("2026-03-07"));
        assert_eq!(st.current_days, 2);
        assert_eq!(st.best_days, 59);
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
