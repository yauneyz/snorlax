/**
 * Pure exact-usage rollup (architecture §7/Phase 7): turn a device's raw focus transition log
 * into per-local-date usage rows. This is the canonical implementation — the Rust service only
 * ever records raw transitions; all bucketing logic lives here, mirroring `scheduleEngine.ts`'s
 * style (clock passed in explicitly, no Electron/native imports) so it is unit-testable without
 * a running app.
 */

import type { TransitionKind, UsageTransition } from '@talysman/shared';

export interface DailyUsage {
  local_date: string;
  platform: string;
  app_version: string;
  focus_seconds: number;
  key_present_seconds: number;
  app_opens: number;
}

function localDateString(epochMs: number, tzOffsetMinutes: number): string {
  const shifted = new Date(epochMs + tzOffsetMinutes * 60_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Epoch ms of the next local midnight strictly after `epochMs`, in the given tz offset. */
function nextLocalMidnight(epochMs: number, tzOffsetMinutes: number): number {
  const shifted = new Date(epochMs + tzOffsetMinutes * 60_000);
  const midnightShifted = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
  );
  return midnightShifted - tzOffsetMinutes * 60_000;
}

/**
 * Pair every `onKind` with the next `offKind` and sum seconds per local date, splitting any
 * interval that crosses local midnight (a 10pm–6am span contributes to two dates, not one). A
 * trailing unterminated `onKind` is treated as still-on through `now`; if the clock has jumped
 * backwards (`now` before the open transition), that trailing interval contributes nothing
 * rather than a bogus negative duration. `transitions` must already be sorted by `seq`.
 */
function sumIntervals(
  transitions: readonly UsageTransition[],
  onKind: TransitionKind,
  offKind: TransitionKind,
  tzOffsetMinutes: number,
  now: Date,
): Map<string, number> {
  const byDate = new Map<string, number>();

  const addInterval = (startMs: number, endMs: number): void => {
    let cursor = startMs;
    while (cursor < endMs) {
      const dayEnd = Math.min(nextLocalMidnight(cursor, tzOffsetMinutes), endMs);
      const date = localDateString(cursor, tzOffsetMinutes);
      byDate.set(date, (byDate.get(date) ?? 0) + (dayEnd - cursor) / 1000);
      cursor = dayEnd;
    }
  };

  let openAt: number | undefined;
  for (const t of transitions) {
    if (t.kind === onKind) {
      if (openAt === undefined) openAt = t.at;
    } else if (t.kind === offKind) {
      if (openAt !== undefined) {
        if (t.at > openAt) addInterval(openAt, t.at);
        openAt = undefined;
      }
    }
  }

  if (openAt !== undefined) {
    const nowMs = now.getTime();
    if (nowMs > openAt) addInterval(openAt, nowMs);
  }

  return byDate;
}

/**
 * Roll a device's transition log up into per-local-date usage rows: `focusOn`/`focusOff` pairs
 * into `focus_seconds`, `keyPresent`/`keyAbsent` pairs into `key_present_seconds` (a leading
 * indicator — key left in = the blocker defeated in spirit). `scheduleFired` doesn't feed a
 * counter today; it exists in the log for future install-health/engagement panels.
 */
export function rollupUsage(
  transitions: UsageTransition[],
  appOpens: number,
  tzOffsetMinutes: number,
  now: Date,
  platform: string,
  appVersion: string,
): DailyUsage[] {
  const sorted = [...transitions].sort((a, b) => a.seq - b.seq);
  const focusByDate = sumIntervals(sorted, 'focusOn', 'focusOff', tzOffsetMinutes, now);
  const keyPresentByDate = sumIntervals(sorted, 'keyPresent', 'keyAbsent', tzOffsetMinutes, now);

  const today = localDateString(now.getTime(), tzOffsetMinutes);
  const allDates = new Set([...focusByDate.keys(), ...keyPresentByDate.keys(), today]);

  return [...allDates]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((local_date) => ({
      local_date,
      platform,
      app_version: appVersion,
      focus_seconds: Math.round(focusByDate.get(local_date) ?? 0),
      key_present_seconds: Math.round(keyPresentByDate.get(local_date) ?? 0),
      app_opens: local_date === today ? appOpens : 0,
    }));
}
