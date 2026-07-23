//! Schedule evaluation — the Rust mirror of packages/core/src/scheduleEngine.ts. Runs inside
//! the service so schedules fire even when the UI is closed. Times are local wall-clock
//! (DST-correct because we read the OS local time directly).

use windows::Win32::System::SystemInformation::GetLocalTime;

use crate::model::Schedule;

const WEEKDAYS: [&str; 7] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

#[derive(Clone, Debug, Default)]
pub struct ScheduleEvaluation {
    pub active: bool,
    pub window_id: Option<String>,
    pub locked: bool,
}

/// Parse "HH:MM" into minutes-since-midnight, or None if malformed.
pub fn parse_hm(hm: &str) -> Option<u32> {
    let (h, m) = hm.split_once(':')?;
    if h.len() != 2 || m.len() != 2 {
        return None;
    }
    let h: u32 = h.parse().ok()?;
    let m: u32 = m.parse().ok()?;
    if h > 23 || m > 59 {
        return None;
    }
    Some(h * 60 + m)
}

fn window_covers(days: &[String], start: u32, end: u32, day: &str, minute: u32) -> bool {
    let day_idx = WEEKDAYS.iter().position(|d| *d == day);
    let Some(day_idx) = day_idx else {
        return false;
    };
    let has_day = |d: &str| days.iter().any(|x| x.eq_ignore_ascii_case(d));

    if start == end {
        return false;
    }
    if start < end {
        return has_day(day) && minute >= start && minute < end;
    }
    // Overnight window (e.g. 22:00–02:00).
    if has_day(day) && minute >= start {
        return true;
    }
    let prev = WEEKDAYS[(day_idx + 6) % 7];
    if has_day(prev) && minute < end {
        return true;
    }
    false
}

/// Current local (weekday, minute-of-day).
fn local_now() -> (String, u32) {
    // SAFETY: GetLocalTime fills a SYSTEMTIME; no invalid inputs.
    let st = unsafe { GetLocalTime() };
    let day = WEEKDAYS
        .get(st.wDayOfWeek as usize)
        .copied()
        .unwrap_or("sun")
        .to_string();
    let minute = st.wHour as u32 * 60 + st.wMinute as u32;
    (day, minute)
}

/// Evaluate the schedule against the current local time.
pub fn evaluate_now(schedule: &Schedule) -> ScheduleEvaluation {
    let (day, minute) = local_now();
    evaluate_at(schedule, &day, minute)
}

/// Evaluate against an explicit (weekday, minute) — used by tests.
pub fn evaluate_at(schedule: &Schedule, day: &str, minute: u32) -> ScheduleEvaluation {
    let mut eval = ScheduleEvaluation::default();
    for w in &schedule.windows {
        let (Some(start), Some(end)) = (parse_hm(&w.start), parse_hm(&w.end)) else {
            continue;
        };
        if window_covers(&w.days, start, end, day, minute) {
            eval.active = true;
            if eval.window_id.is_none() {
                eval.window_id = Some(w.id.clone());
            }
            if w.locked {
                eval.locked = true;
                eval.window_id = Some(w.id.clone());
            }
        }
    }
    eval
}

/// Whether `next` enforces at least as much as `prev` at every minute of the week: it never drops
/// a covered (focus-forced) minute and never unlocks a locked one. Equal or stricter schedules
/// return true; any relaxation returns false. Window policy references are not compared here —
/// coverage and locking are the schedule's own contribution to enforcement.
pub fn is_at_least_as_restrictive(prev: &Schedule, next: &Schedule) -> bool {
    for day in WEEKDAYS {
        for minute in 0..24 * 60 {
            let p = evaluate_at(prev, day, minute);
            if !p.active {
                continue;
            }
            let n = evaluate_at(next, day, minute);
            if !n.active || (p.locked && !n.locked) {
                return false;
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ScheduleWindow;

    fn win(id: &str, locked: bool) -> ScheduleWindow {
        ScheduleWindow {
            id: id.into(),
            days: vec![
                "mon".into(),
                "tue".into(),
                "wed".into(),
                "thu".into(),
                "fri".into(),
            ],
            start: "09:00".into(),
            end: "17:00".into(),
            policy_id: None,
            locked,
        }
    }

    #[test]
    fn parse() {
        assert_eq!(parse_hm("09:30"), Some(570));
        assert_eq!(parse_hm("24:00"), None);
        assert_eq!(parse_hm("9:00"), None);
    }

    #[test]
    fn active_window() {
        let s = Schedule {
            windows: vec![win("w1", false)],
        };
        let e = evaluate_at(&s, "mon", 10 * 60);
        assert!(e.active);
        assert_eq!(e.window_id.as_deref(), Some("w1"));
        assert!(!e.locked);
    }

    #[test]
    fn locked_wins() {
        let s = Schedule {
            windows: vec![win("a", false), win("b", true)],
        };
        let e = evaluate_at(&s, "mon", 10 * 60);
        assert!(e.locked);
        assert_eq!(e.window_id.as_deref(), Some("b"));
    }

    #[test]
    fn overnight() {
        let mut w = win("n", false);
        w.days = vec!["fri".into()];
        w.start = "22:00".into();
        w.end = "02:00".into();
        let s = Schedule { windows: vec![w] };
        assert!(evaluate_at(&s, "fri", 23 * 60).active);
        assert!(evaluate_at(&s, "sat", 60).active);
        assert!(!evaluate_at(&s, "sat", 3 * 60).active);
    }
}
