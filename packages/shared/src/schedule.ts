/**
 * Schedule data model (spec §3.9), generated from the Rust engine which alone evaluates it. Each
 * profile owns its rules: `window` (active during a weekly time range, optionally `locked`),
 * `at` (recurring "on at"/"off at" latch flips), plus one-shot events.
 */

import type { Weekday } from './generated/index.js';

export type { OneShotEvent, OnOff, ScheduleRule, UpcomingEvent, UpcomingKind, Weekday, WindowOccurrence } from './generated/index.js';

export const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** "HH:MM" → minutes after midnight, or null. */
export function parseHm(hm: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hm);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h <= 23 && m <= 59 ? h * 60 + m : null;
}

/** Window length in minutes; windows ending at or before their start run past midnight. */
export function windowMinutes(start: string, end: string): number {
  const s = parseHm(start);
  const e = parseHm(end);
  if (s === null || e === null || s === e) return 0;
  return e > s ? e - s : 24 * 60 - s + e;
}
