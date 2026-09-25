//! Local wall-clock arithmetic. The engine never reads a clock: every call receives a [`LocalNow`]
//! (epoch milliseconds plus the local UTC offset at that instant) from the platform shell. Local
//! times of day are converted back to epoch milliseconds using the *current* offset, which is
//! exact except within an hour of a DST change; platforms re-tick on time-zone changes and
//! `next_wake_ms` is capped at an hour, so any drift self-corrects.

use serde::{Deserialize, Serialize};

pub const MINUTE_MS: i64 = 60_000;
pub const HOUR_MS: i64 = 60 * MINUTE_MS;
pub const DAY_MS: i64 = 24 * HOUR_MS;
pub const MINUTES_PER_DAY: u16 = 24 * 60;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct LocalNow {
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub epoch_ms: i64,
    /// Seconds east of UTC (e.g. -25200 for PDT).
    pub utc_offset_s: i32,
}

/// Day of the week, Sunday first — matches `Weekday` in packages/shared/src/schedule.ts.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum Weekday {
    Sun,
    Mon,
    Tue,
    Wed,
    Thu,
    Fri,
    Sat,
}

impl Weekday {
    pub const ALL: [Weekday; 7] = [
        Weekday::Sun,
        Weekday::Mon,
        Weekday::Tue,
        Weekday::Wed,
        Weekday::Thu,
        Weekday::Fri,
        Weekday::Sat,
    ];

    pub fn index(self) -> usize {
        self as usize
    }

    pub fn from_index(index: usize) -> Weekday {
        Weekday::ALL[index % 7]
    }

    pub fn prev(self) -> Weekday {
        Weekday::from_index(self.index() + 6)
    }
}

impl LocalNow {
    pub fn new(epoch_ms: i64, utc_offset_s: i32) -> Self {
        LocalNow { epoch_ms, utc_offset_s }
    }

    fn offset_ms(&self) -> i64 {
        self.utc_offset_s as i64 * 1000
    }

    /// Milliseconds since the local-time epoch (1970-01-01T00:00 local).
    pub fn local_ms(&self) -> i64 {
        self.epoch_ms + self.offset_ms()
    }

    /// Local day number (days since 1970-01-01 local).
    pub fn day(&self) -> i64 {
        self.local_ms().div_euclid(DAY_MS)
    }

    pub fn weekday(&self) -> Weekday {
        weekday_of_day(self.day())
    }

    /// Minutes since local midnight.
    pub fn minute_of_day(&self) -> u16 {
        (self.local_ms().rem_euclid(DAY_MS) / MINUTE_MS) as u16
    }

    /// "YYYY-MM-DD" in local time.
    pub fn date_string(&self) -> String {
        date_string(self.day())
    }

    /// Epoch ms of local midnight starting local day `day`.
    pub fn epoch_of_day(&self, day: i64) -> i64 {
        day * DAY_MS - self.offset_ms()
    }

    /// Epoch ms of `minute` (minutes after local midnight) on local day `day`.
    pub fn epoch_at(&self, day: i64, minute: u16) -> i64 {
        self.epoch_of_day(day) + minute as i64 * MINUTE_MS
    }

    /// Same offset, different instant.
    pub fn at(&self, epoch_ms: i64) -> LocalNow {
        LocalNow { epoch_ms, utc_offset_s: self.utc_offset_s }
    }

    /// Epoch ms of the next local midnight.
    pub fn next_midnight(&self) -> i64 {
        self.epoch_of_day(self.day() + 1)
    }
}

/// 1970-01-01 was a Thursday.
pub fn weekday_of_day(day: i64) -> Weekday {
    Weekday::from_index((day + 4).rem_euclid(7) as usize)
}

/// Gregorian civil date for a day number (Howard Hinnant's `civil_from_days`).
pub fn civil_from_days(day: i64) -> (i64, u32, u32) {
    let z = day + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Day number for a Gregorian civil date (`days_from_civil`).
pub fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let m = m as i64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

pub fn date_string(day: i64) -> String {
    let (y, m, d) = civil_from_days(day);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Parse "YYYY-MM-DD" into a day number.
pub fn parse_date(date: &str) -> Option<i64> {
    let mut parts = date.split('-');
    let y: i64 = parts.next()?.parse().ok()?;
    let m: u32 = parts.next()?.parse().ok()?;
    let d: u32 = parts.next()?.parse().ok()?;
    if parts.next().is_some() || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some(days_from_civil(y, m, d))
}

/// Parse "HH:MM" (24h) into minutes after midnight.
pub fn parse_hm(hm: &str) -> Option<u16> {
    let (h, m) = hm.split_once(':')?;
    if h.len() != 2 || m.len() != 2 {
        return None;
    }
    let h: u16 = h.parse().ok()?;
    let m: u16 = m.parse().ok()?;
    if h > 23 || m > 59 {
        return None;
    }
    Some(h * 60 + m)
}

pub fn format_hm(minute: u16) -> String {
    format!("{:02}:{:02}", minute / 60, minute % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_round_trips_and_knows_weekdays() {
        assert_eq!(date_string(0), "1970-01-01");
        assert_eq!(weekday_of_day(0), Weekday::Thu);
        let day = days_from_civil(2026, 9, 24);
        assert_eq!(date_string(day), "2026-09-24");
        assert_eq!(weekday_of_day(day), Weekday::Thu);
        assert_eq!(parse_date("2024-02-29"), Some(days_from_civil(2024, 2, 29)));
        assert_eq!(parse_date("2024-13-01"), None);
    }

    #[test]
    fn local_now_applies_the_offset() {
        // 2026-09-24T02:30Z is 2026-09-23 19:30 in PDT (-7h).
        let utc = days_from_civil(2026, 9, 24) * DAY_MS + 2 * HOUR_MS + 30 * MINUTE_MS;
        let now = LocalNow::new(utc, -7 * 3600);
        assert_eq!(now.date_string(), "2026-09-23");
        assert_eq!(now.minute_of_day(), 19 * 60 + 30);
        assert_eq!(now.weekday(), Weekday::Wed);
        assert_eq!(now.epoch_at(now.day(), 19 * 60 + 30), utc);
        assert_eq!(now.next_midnight(), utc + 4 * HOUR_MS + 30 * MINUTE_MS);
    }

    #[test]
    fn hm_parsing_is_strict() {
        assert_eq!(parse_hm("09:05"), Some(545));
        assert_eq!(parse_hm("9:05"), None);
        assert_eq!(parse_hm("24:00"), None);
        assert_eq!(format_hm(545), "09:05");
    }
}
