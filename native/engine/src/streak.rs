//! Streak and emergency-unlock accounting. Both are pure functions of the journal, so merging
//! journals from several devices (a future account sync) yields the right numbers for free.

use serde::{Deserialize, Serialize};

use crate::model::{EngineState, JournalKind, EMERGENCY_LIFETIME_LIMIT};
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

pub fn emergency_used(state: &EngineState) -> u8 {
    state.journal.iter().filter(|e| matches!(e.kind, JournalKind::EmergencyUsed)).count().min(u8::MAX as usize) as u8
}

pub fn emergency_left(state: &EngineState) -> u8 {
    EMERGENCY_LIFETIME_LIMIT.saturating_sub(emergency_used(state))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::JournalEntry;
    use crate::time::{days_from_civil, DAY_MS};

    fn entry(date: &str, breaks: bool, kind: JournalKind) -> JournalEntry {
        JournalEntry { id: date.into(), device_id: "d".into(), seq: 0, at_ms: 0, local_date: date.into(), breaks_streak: breaks, kind }
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
        assert_eq!(emergency_left(&s), EMERGENCY_LIFETIME_LIMIT - 1);
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
}
