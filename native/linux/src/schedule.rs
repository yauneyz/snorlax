//! Schedule evaluation for Linux. Times are local wall-clock.

use chrono::{Datelike, Local, Timelike};

use crate::model::Schedule;

const WEEKDAYS: [&str; 7] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

#[derive(Clone, Debug, Default)]
pub struct ScheduleEvaluation {
    pub active: bool,
    pub window_id: Option<String>,
    pub locked: bool,
}

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
    if has_day(day) && minute >= start {
        return true;
    }
    let prev = WEEKDAYS[(day_idx + 6) % 7];
    has_day(prev) && minute < end
}

fn local_now() -> (String, u32) {
    let now = Local::now();
    let day = WEEKDAYS
        .get(now.weekday().num_days_from_sunday() as usize)
        .copied()
        .unwrap_or("sun")
        .to_string();
    let minute = now.hour() * 60 + now.minute();
    (day, minute)
}

pub fn evaluate_now(schedule: &Schedule) -> ScheduleEvaluation {
    let (day, minute) = local_now();
    evaluate_at(schedule, &day, minute)
}

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
