/**
 * Pure schedule evaluation (architecture §8). Given a schedule and a wall-clock instant,
 * decide whether focus should be on right now, and whether the active window is `locked`.
 *
 * This is the canonical implementation; the Rust service mirrors the same logic in
 * native/windows/src/schedule.rs. Keeping it pure makes it trivially unit-testable.
 *
 * Times are evaluated against local wall-clock (DST is handled implicitly because we read
 * the local hour/minute/weekday off the provided Date, never a stored UTC offset).
 */

import type { Schedule, ScheduleWindow, Weekday } from '@focuslock/shared';
import { WEEKDAYS } from '@focuslock/shared';

export interface ScheduleEvaluation {
  /** Should focus be active now per the schedule? */
  active: boolean;
  /** The window currently driving `active`, if any. */
  windowId?: string;
  /** True if the active window is locked (USB key cannot disable). */
  locked: boolean;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Parse "HH:MM" to minutes-since-midnight, or null if malformed. */
export function parseHm(hm: string): number | null {
  const m = TIME_RE.exec(hm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function weekdayOf(date: Date): Weekday {
  return WEEKDAYS[date.getDay()]!;
}

/**
 * Does `window` cover the given weekday + minute-of-day? Windows where end <= start are
 * treated as crossing midnight (e.g. 22:00–02:00).
 */
export function windowCovers(window: ScheduleWindow, day: Weekday, minuteOfDay: number): boolean {
  const start = parseHm(window.start);
  const end = parseHm(window.end);
  if (start === null || end === null) return false;

  if (start === end) return false; // zero-length window never matches

  if (start < end) {
    // Same-day window.
    return window.days.includes(day) && minuteOfDay >= start && minuteOfDay < end;
  }

  // Overnight window: active from `start` today through `end` tomorrow.
  // The "today" half is gated on the window's own day list; the "tomorrow" half belongs to
  // the window that *started* on the previous day.
  if (window.days.includes(day) && minuteOfDay >= start) return true;
  const prevDay = WEEKDAYS[(WEEKDAYS.indexOf(day) + 6) % 7]!;
  if (window.days.includes(prevDay) && minuteOfDay < end) return true;
  return false;
}

/**
 * Evaluate the whole schedule at `now`. Focus is active if any window covers the instant.
 * `locked` is true if any *covering* window is locked (lock wins for safety).
 */
export function evaluateSchedule(schedule: Schedule, now: Date): ScheduleEvaluation {
  const day = weekdayOf(now);
  const minute = now.getHours() * 60 + now.getMinutes();

  let active = false;
  let locked = false;
  let windowId: string | undefined;

  for (const w of schedule.windows) {
    if (windowCovers(w, day, minute)) {
      active = true;
      if (!windowId) windowId = w.id;
      if (w.locked) {
        locked = true;
        windowId = w.id; // prefer reporting the locked window
      }
    }
  }

  return { active, windowId, locked };
}
