//! Schedule evaluation — the single implementation that replaces the three per-platform
//! `native/*/src/schedule.rs` copies and `packages/core/src/scheduleEngine.ts`.
//!
//! Semantics (unchanged from the v5 desktop): a window covers `[start, end)` local time on each of
//! its days; `end <= start` crosses midnight into the next day (so a Friday 22:00–02:00 window
//! covers Saturday 00:00–02:00); `start == end` never matches.

use crate::model::{OnOff, ScheduleRule, WindowOccurrence};
use crate::time::{parse_hm, LocalNow, Weekday, MINUTES_PER_DAY};

/// A window with its times parsed. Rules with unparseable times are ignored by evaluation (and
/// rejected at the command boundary by validation).
#[derive(Clone, Debug)]
pub struct ParsedWindow<'a> {
    pub id: &'a str,
    pub days: &'a [Weekday],
    pub start: u16,
    pub end: u16,
    pub locked: bool,
}

pub fn parsed_windows(rules: &[ScheduleRule]) -> impl Iterator<Item = ParsedWindow<'_>> {
    rules.iter().filter_map(|rule| match rule {
        ScheduleRule::Window { id, days, start, end, locked } => Some(ParsedWindow {
            id,
            days,
            start: parse_hm(start)?,
            end: parse_hm(end)?,
            locked: *locked,
        }),
        ScheduleRule::At { .. } => None,
    })
}

/// Does the window cover `minute` on `day`?
pub fn covers(days: &[Weekday], start: u16, end: u16, day: Weekday, minute: u16) -> bool {
    if start == end {
        return false;
    }
    let has = |d: Weekday| days.contains(&d);
    if start < end {
        return has(day) && minute >= start && minute < end;
    }
    (has(day) && minute >= start) || (has(day.prev()) && minute < end)
}

impl ParsedWindow<'_> {
    /// The occurrence covering `now`, if any.
    pub fn occurrence_at(&self, profile_id: &str, now: &LocalNow) -> Option<WindowOccurrence> {
        let (day, weekday, minute) = (now.day(), now.weekday(), now.minute_of_day());
        if !covers(self.days, self.start, self.end, weekday, minute) {
            return None;
        }
        let length = if self.start < self.end {
            self.end - self.start
        } else {
            MINUTES_PER_DAY - self.start + self.end
        } as i64;
        // An overnight window covering an early-morning minute started yesterday.
        let start_day = if self.start > self.end && minute < self.end && !(self.days.contains(&weekday) && minute >= self.start) {
            day - 1
        } else {
            day
        };
        let start_ms = now.epoch_at(start_day, self.start);
        Some(WindowOccurrence {
            profile_id: profile_id.to_string(),
            window_id: self.id.to_string(),
            start_ms,
            end_ms: start_ms + length * 60_000,
            locked: self.locked,
        })
    }
}

/// Every occurrence of any window in `rules` that covers `now`.
pub fn live_occurrences(profile_id: &str, rules: &[ScheduleRule], now: &LocalNow) -> Vec<WindowOccurrence> {
    parsed_windows(rules)
        .filter_map(|w| w.occurrence_at(profile_id, now))
        .collect()
}

/// Epoch ms of the next minute at which any window of `rules` starts or ends, strictly after
/// `now`, searching up to 8 days ahead.
pub fn next_window_edge(rules: &[ScheduleRule], now: &LocalNow) -> Option<i64> {
    let windows: Vec<ParsedWindow> = parsed_windows(rules).filter(|w| w.start != w.end).collect();
    if windows.is_empty() {
        return None;
    }
    let mut best: Option<i64> = None;
    for offset in 0..=8i64 {
        let day = now.day() + offset;
        let weekday = crate::time::weekday_of_day(day);
        for w in &windows {
            let mut candidates = Vec::new();
            if w.days.contains(&weekday) {
                candidates.push(w.start);
                if w.start < w.end {
                    candidates.push(w.end);
                }
            }
            // An overnight window started yesterday ends today.
            if w.start > w.end && w.days.contains(&weekday.prev()) {
                candidates.push(w.end);
            }
            for minute in candidates {
                let at = now.epoch_at(day, minute);
                if at > now.epoch_ms && best.is_none_or(|b| at < b) {
                    best = Some(at);
                }
            }
        }
        if best.is_some_and(|b| b < now.epoch_of_day(day + 1)) {
            break;
        }
    }
    best
}

/// A recurring At rule firing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AtFiring {
    pub at_ms: i64,
    pub rule_id: String,
    pub action: OnOff,
}

/// Every At-rule firing in the half-open interval `(after_ms, until.epoch_ms]`, oldest first.
/// Replays at most `max_days` local days back so a long-dormant device doesn't loop forever.
pub fn at_firings(rules: &[ScheduleRule], after_ms: i64, until: &LocalNow, max_days: i64) -> Vec<AtFiring> {
    let mut out = Vec::new();
    let first_day = until.at(after_ms).day().max(until.day() - max_days);
    for rule in rules {
        let ScheduleRule::At { id, days, at, action } = rule else { continue };
        let Some(minute) = parse_hm(at) else { continue };
        for day in first_day..=until.day() {
            if !days.contains(&crate::time::weekday_of_day(day)) {
                continue;
            }
            let at_ms = until.epoch_at(day, minute);
            if at_ms > after_ms && at_ms <= until.epoch_ms {
                out.push(AtFiring { at_ms, rule_id: id.clone(), action: *action });
            }
        }
    }
    out.sort_by_key(|f| f.at_ms);
    out
}

/// The next At-rule firing strictly after `now`.
pub fn next_at_firing(rules: &[ScheduleRule], now: &LocalNow) -> Option<AtFiring> {
    let horizon = now.at(now.epoch_of_day(now.day() + 8));
    at_firings(rules, now.epoch_ms, &horizon, 9).into_iter().next()
}

/// Minutes of the week (0 = Sunday 00:00) covered by the windows in `rules`: `(covered, locked)`.
pub fn weekly_coverage(rules: &[ScheduleRule]) -> (Vec<bool>, Vec<bool>) {
    let mut covered = vec![false; 7 * MINUTES_PER_DAY as usize];
    let mut locked = vec![false; 7 * MINUTES_PER_DAY as usize];
    let windows: Vec<ParsedWindow> = parsed_windows(rules).collect();
    for day in Weekday::ALL {
        for minute in 0..MINUTES_PER_DAY {
            let index = day.index() * MINUTES_PER_DAY as usize + minute as usize;
            for w in &windows {
                if covers(w.days, w.start, w.end, day, minute) {
                    covered[index] = true;
                    if w.locked {
                        locked[index] = true;
                    }
                }
            }
        }
    }
    (covered, locked)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::time::{days_from_civil, DAY_MS, HOUR_MS};

    const WEEKDAYS: [Weekday; 5] = [Weekday::Mon, Weekday::Tue, Weekday::Wed, Weekday::Thu, Weekday::Fri];

    fn window(id: &str, days: &[Weekday], start: &str, end: &str, locked: bool) -> ScheduleRule {
        ScheduleRule::Window { id: id.into(), days: days.to_vec(), start: start.into(), end: end.into(), locked }
    }

    fn at(id: &str, days: &[Weekday], time: &str, action: OnOff) -> ScheduleRule {
        ScheduleRule::At { id: id.into(), days: days.to_vec(), at: time.into(), action }
    }

    /// Monday 2026-09-21 at `h:m` UTC (offset 0).
    fn monday(h: i64, m: i64) -> LocalNow {
        LocalNow::new(days_from_civil(2026, 9, 21) * DAY_MS + h * HOUR_MS + m * 60_000, 0)
    }

    #[test]
    fn same_day_window_is_half_open() {
        assert!(covers(&WEEKDAYS, 540, 1020, Weekday::Mon, 540));
        assert!(covers(&WEEKDAYS, 540, 1020, Weekday::Mon, 1019));
        assert!(!covers(&WEEKDAYS, 540, 1020, Weekday::Mon, 1020));
        assert!(!covers(&WEEKDAYS, 540, 1020, Weekday::Sat, 600));
    }

    #[test]
    fn overnight_window_spills_into_the_next_day() {
        let fri = [Weekday::Fri];
        assert!(covers(&fri, 22 * 60, 2 * 60, Weekday::Fri, 23 * 60));
        assert!(covers(&fri, 22 * 60, 2 * 60, Weekday::Sat, 60));
        assert!(!covers(&fri, 22 * 60, 2 * 60, Weekday::Sat, 23 * 60));
        assert!(!covers(&fri, 22 * 60, 2 * 60, Weekday::Fri, 60));
    }

    #[test]
    fn start_equal_to_end_never_matches() {
        assert!(!covers(&Weekday::ALL, 600, 600, Weekday::Mon, 600));
    }

    #[test]
    fn occurrences_have_stable_identity_across_midnight() {
        let rules = vec![window("w", &[Weekday::Mon], "22:00", "02:00", true)];
        let late = live_occurrences("p", &rules, &monday(23, 0));
        let early = live_occurrences("p", &rules, &monday(25, 0)); // Tuesday 01:00
        assert_eq!(late.len(), 1);
        assert_eq!(early.len(), 1);
        assert!(late[0].same(&early[0]));
        assert_eq!(late[0].end_ms - late[0].start_ms, 4 * HOUR_MS);
        assert!(late[0].locked);
    }

    #[test]
    fn next_edge_finds_start_then_end() {
        let rules = vec![window("w", &WEEKDAYS, "09:00", "17:00", false)];
        assert_eq!(next_window_edge(&rules, &monday(8, 0)), Some(monday(9, 0).epoch_ms));
        assert_eq!(next_window_edge(&rules, &monday(9, 0)), Some(monday(17, 0).epoch_ms));
        // Friday 17:00 → next Monday 09:00.
        let friday = monday(4 * 24 + 17, 0);
        assert_eq!(next_window_edge(&rules, &friday), Some(monday(7 * 24 + 9, 0).epoch_ms));
    }

    #[test]
    fn at_firings_replay_in_order_and_exclude_the_lower_bound() {
        let rules = vec![at("on", &WEEKDAYS, "09:00", OnOff::On), at("off", &WEEKDAYS, "17:00", OnOff::Off)];
        let firings = at_firings(&rules, monday(9, 0).epoch_ms, &monday(24 + 10, 0), 14);
        let ids: Vec<&str> = firings.iter().map(|f| f.rule_id.as_str()).collect();
        assert_eq!(ids, vec!["off", "on"]);
        assert_eq!(next_at_firing(&rules, &monday(10, 0)).unwrap().rule_id, "off");
    }

    #[test]
    fn weekly_coverage_marks_locked_minutes() {
        let rules = vec![window("w", &[Weekday::Sun], "00:00", "00:02", true)];
        let (covered, locked) = weekly_coverage(&rules);
        assert!(covered[0] && covered[1] && !covered[2]);
        assert!(locked[1]);
    }
}
