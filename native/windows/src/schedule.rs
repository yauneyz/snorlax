//! Schedule evaluation — the Rust mirror of packages/core/src/scheduleEngine.ts. Runs inside
//! the service so schedules fire even when the UI is closed. Times are local wall-clock
//! (DST-correct because we read the OS local time directly).

use std::time::Duration;
use windows::Win32::System::SystemInformation::GetLocalTime;

use crate::model::{Policy, Profile, Schedule};

const WEEKDAYS: [&str; 7] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ScheduleEvaluation {
    pub active: bool,
    pub window_id: Option<String>,
    /// Blocking profile the driving window switches to, if it names one.
    pub profile_id: Option<String>,
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

pub fn next_transition_delay(schedule: &Schedule) -> Duration {
    let st = unsafe { GetLocalTime() };
    let day = st.wDayOfWeek as u32;
    let minute = st.wHour as u32 * 60 + st.wMinute as u32;
    let current = evaluate_at(schedule, WEEKDAYS[day as usize], minute);
    let base = day * 24 * 60 + minute;
    let to_next_minute_ms =
        (60_000u64 - (st.wSecond as u64 * 1_000 + st.wMilliseconds as u64)).max(1);
    for offset in 1..=7 * 24 * 60 {
        let future = (base + offset) % (7 * 24 * 60);
        let next = evaluate_at(
            schedule,
            WEEKDAYS[(future / (24 * 60)) as usize],
            future % (24 * 60),
        );
        if next != current {
            return Duration::from_millis(to_next_minute_ms + (offset as u64 - 1) * 60_000)
                .min(Duration::from_secs(60 * 60));
        }
    }
    Duration::from_secs(60 * 60)
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
                eval.profile_id = w.profile_id.clone();
            }
            if w.locked && !eval.locked {
                eval.locked = true;
                // Prefer reporting the locked window — and the profile it demands.
                eval.window_id = Some(w.id.clone());
                eval.profile_id = w.profile_id.clone();
            }
        }
    }
    eval
}

/// Whether `next` enforces at least as much as `prev` at every minute of the week: it never drops
/// a covered (focus-forced) minute, never unlocks a locked one, and never swaps in a laxer
/// blocking profile. Equal or stricter schedules return true; any relaxation returns false.
///
/// `profiles` / `active_profile_id` resolve each window's `profile_id` to the policy it would
/// actually enforce — repointing a window at an emptier profile is as much a relaxation as
/// deleting the window outright.
pub fn is_at_least_as_restrictive(
    prev: &Schedule,
    next: &Schedule,
    profiles: &[Profile],
    active_profile_id: &str,
) -> bool {
    let resolve = |id: Option<&str>| -> Option<&Policy> {
        let wanted = id.unwrap_or(active_profile_id);
        profiles
            .iter()
            .find(|p| p.id == wanted)
            .or_else(|| profiles.iter().find(|p| p.id == active_profile_id))
            .or_else(|| profiles.first())
            .map(|p| &p.policy)
    };

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
            if p.profile_id == n.profile_id {
                continue;
            }
            match (
                resolve(p.profile_id.as_deref()),
                resolve(n.profile_id.as_deref()),
            ) {
                (Some(prev_policy), Some(next_policy)) => {
                    if !crate::policy_match::is_at_least_as_restrictive(prev_policy, next_policy) {
                        return false;
                    }
                }
                // No profiles to compare against (shouldn't happen post-migration) — treat a
                // profile change as a relaxation rather than waving it through.
                _ => return false,
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
            profile_id: None,
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

#[cfg(test)]
mod profile_tests {
    use super::*;
    use crate::model::{Mode, Policy, ScheduleWindow};

    fn profile(id: &str, policy: Policy) -> Profile {
        Profile {
            id: id.into(),
            name: id.into(),
            color: "#4fd6c0".into(),
            policy,
        }
    }

    fn blacklist(domains: &[&str]) -> Policy {
        Policy {
            mode: Mode::Blacklist,
            domains: domains.iter().map(|d| (*d).to_string()).collect(),
            apps: Vec::new(),
        }
    }

    fn win(id: &str, profile_id: Option<&str>, locked: bool) -> ScheduleWindow {
        ScheduleWindow {
            id: id.into(),
            days: vec!["mon".into()],
            start: "09:00".into(),
            end: "17:00".into(),
            profile_id: profile_id.map(|s| s.to_string()),
            locked,
        }
    }

    fn profiles() -> Vec<Profile> {
        vec![
            profile("strict", blacklist(&["a.com", "b.com"])),
            profile("lax", blacklist(&["a.com"])),
        ]
    }

    #[test]
    fn evaluation_reports_the_window_profile() {
        let s = Schedule {
            windows: vec![win("w1", Some("strict"), false)],
        };
        let e = evaluate_at(&s, "mon", 10 * 60);
        assert!(e.active);
        assert_eq!(e.profile_id.as_deref(), Some("strict"));
    }

    #[test]
    fn a_locked_window_wins_the_profile_when_windows_overlap() {
        let s = Schedule {
            windows: vec![
                win("w1", Some("lax"), false),
                win("w2", Some("strict"), true),
            ],
        };
        let e = evaluate_at(&s, "mon", 10 * 60);
        assert!(e.locked);
        assert_eq!(e.profile_id.as_deref(), Some("strict"));
    }

    #[test]
    fn repointing_a_window_at_a_laxer_profile_is_blocked() {
        let prev = Schedule {
            windows: vec![win("w1", Some("strict"), false)],
        };
        let next = Schedule {
            windows: vec![win("w1", Some("lax"), false)],
        };
        assert!(!is_at_least_as_restrictive(
            &prev,
            &next,
            &profiles(),
            "strict"
        ));
    }

    #[test]
    fn repointing_a_window_at_a_stricter_profile_is_allowed() {
        let prev = Schedule {
            windows: vec![win("w1", Some("lax"), false)],
        };
        let next = Schedule {
            windows: vec![win("w1", Some("strict"), false)],
        };
        assert!(is_at_least_as_restrictive(
            &prev,
            &next,
            &profiles(),
            "strict"
        ));
    }

    #[test]
    fn an_unpinned_window_resolves_to_the_active_profile() {
        // prev inherits "strict" (the active profile); next pins the laxer one.
        let prev = Schedule {
            windows: vec![win("w1", None, false)],
        };
        let next = Schedule {
            windows: vec![win("w1", Some("lax"), false)],
        };
        assert!(!is_at_least_as_restrictive(
            &prev,
            &next,
            &profiles(),
            "strict"
        ));
        assert!(is_at_least_as_restrictive(
            &next,
            &prev,
            &profiles(),
            "strict"
        ));
    }
}
