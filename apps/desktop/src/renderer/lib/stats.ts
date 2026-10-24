/**
 * Pure computations behind the Stats page. Everything is derived on the fly from what the service
 * already keeps on this device (`getStats`): the focus on/off log, the engine journal, and — only
 * when the user opted in — per-day blocked-site counts. Times are bucketed in local time.
 */

import type { BlockedSiteDay, JournalEntry, OverrideKind, StatsData, UsageTransition } from '@talysman/shared';

export type RangeDays = 7 | 30;

export interface Interval {
  start: number;
  end: number;
}

export interface DayStat {
  /** "YYYY-MM-DD", local. */
  date: string;
  /** Local midnight starting the day. */
  startMs: number;
  focusMs: number;
}

export interface SiteCount {
  host: string;
  count: number;
}

export interface Ledger {
  poolUnlocks: number;
  poolMinutes: number;
  pauses: number;
  pausedMs: number;
  turnedOff: number;
  turnedOffMs: number;
  exemptions: number;
  emergencies: number;
}

export interface StatsSummary {
  rangeStartMs: number;
  focusMs: number;
  /** The same-length period just before the range, when the focus log reaches back to its first day. */
  prevFocusMs: number | null;
  days: DayStat[];
  /** [weekday Mon..Sun][hour 0..23] → focus ms in the range. */
  hourGrid: number[][];
  sessions: number;
  longestSessionMs: number;
  /** Share of sessions in range a schedule started (vs. the user), 0..1; null with no sessions. */
  scheduledShare: number | null;
  ledger: Ledger;
  blockedTotal: number;
  prevBlockedTotal: number | null;
  topSites: SiteCount[];
  /** Journal entries in range, newest first. */
  recent: JournalEntry[];
}

const HOUR_MS = 60 * 60 * 1000;

export function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local midnight `daysBack` days before the day containing `ms`. */
export function startOfLocalDay(ms: number, daysBack = 0): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysBack);
  return d.getTime();
}

/**
 * Pair `focusOn`/`focusOff` into intervals. The service records `focusOn` again when it re-arms
 * after a restart without ever having written `focusOff`, so a second `focusOn` closes the open
 * interval at the last thing the log saw — time the machine was off isn't counted as focus.
 */
export function focusIntervals(usage: readonly UsageTransition[], nowMs: number): Interval[] {
  const sorted = [...usage].sort((a, b) => a.seq - b.seq);
  const out: Interval[] = [];
  let open: { start: number; source: UsageTransition['source'] } | null = null;
  let lastSeen = 0;
  for (const t of sorted) {
    if (t.kind === 'focusOn') {
      if (open && lastSeen > open.start) out.push({ start: open.start, end: lastSeen });
      open = { start: t.at, source: t.source };
    } else if (t.kind === 'focusOff' && open) {
      if (t.at > open.start) out.push({ start: open.start, end: t.at });
      open = null;
    }
    lastSeen = t.at;
  }
  if (open && nowMs > open.start) out.push({ start: open.start, end: nowMs });
  return out;
}

function overlap(i: Interval, from: number, to: number): number {
  return Math.max(0, Math.min(i.end, to) - Math.max(i.start, from));
}

function sumOverlap(intervals: readonly Interval[], from: number, to: number): number {
  return intervals.reduce((sum, i) => sum + overlap(i, from, to), 0);
}

/** Monday-first weekday index. */
function weekdayIndex(ms: number): number {
  return (new Date(ms).getDay() + 6) % 7;
}

function hourGrid(intervals: readonly Interval[], from: number, to: number): number[][] {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const i of intervals) {
    let cursor = Math.max(i.start, from);
    const end = Math.min(i.end, to);
    while (cursor < end) {
      const d = new Date(cursor);
      d.setMinutes(0, 0, 0);
      const hourEnd = Math.min(d.getTime() + HOUR_MS, end);
      grid[weekdayIndex(cursor)]![new Date(cursor).getHours()]! += hourEnd - cursor;
      cursor = hourEnd;
    }
  }
  return grid;
}

/** How long each override kind ran, pairing started → ended (or "re-enable all"), open → now. */
function overrideDurations(journal: readonly JournalEntry[], from: number, to: number) {
  const open = new Map<OverrideKind, number>();
  const ms: Record<OverrideKind, number> = { allOff: 0, exempt: 0, timed: 0 };
  const close = (kind: OverrideKind, at: number) => {
    const start = open.get(kind);
    if (start === undefined) return;
    ms[kind] += overlap({ start, end: at }, from, to);
    open.delete(kind);
  };
  for (const e of journal) {
    if (e.kind.kind === 'overrideStarted') {
      if (!open.has(e.kind.override)) open.set(e.kind.override, e.atMs);
    } else if (e.kind.kind === 'overrideEnded') {
      close(e.kind.override, e.atMs);
    } else if (e.kind.kind === 'reenabledAll') {
      for (const kind of [...open.keys()]) close(kind, e.atMs);
    }
  }
  for (const kind of [...open.keys()]) close(kind, to);
  return ms;
}

function ledger(journal: readonly JournalEntry[], from: number, to: number): Ledger {
  const inRange = journal.filter((e) => e.atMs >= from && e.atMs < to);
  const started = (kind: OverrideKind) =>
    inRange.filter((e) => e.kind.kind === 'overrideStarted' && e.kind.override === kind).length;
  const durations = overrideDurations(journal, from, to);
  let poolUnlocks = 0;
  let poolMinutes = 0;
  for (const e of inRange) {
    if (e.kind.kind === 'poolUnlocked') {
      poolUnlocks += 1;
      poolMinutes += e.kind.minutes;
    }
  }
  return {
    poolUnlocks,
    poolMinutes,
    pauses: started('timed'),
    pausedMs: durations.timed,
    turnedOff: started('allOff'),
    turnedOffMs: durations.allOff,
    exemptions: started('exempt'),
    emergencies: inRange.filter((e) => e.kind.kind === 'emergencyUsed').length,
  };
}

function blockedIn(days: readonly BlockedSiteDay[], fromDate: string, toDate: string): Map<string, number> {
  const totals = new Map<string, number>();
  for (const day of days) {
    if (day.localDate < fromDate || day.localDate > toDate) continue;
    for (const [host, count] of Object.entries(day.hosts)) totals.set(host, (totals.get(host) ?? 0) + count);
  }
  return totals;
}

const sumValues = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

/** Journal kinds worth showing in the activity feed (profile edits and migrations are noise). */
const FEED_KINDS = new Set<JournalEntry['kind']['kind']>([
  'profileOn',
  'profileOff',
  'overrideStarted',
  'reenabledAll',
  'relaxed',
  'poolUnlocked',
  'emergencyUsed',
]);

export function summarize(data: StatsData, range: RangeDays, nowMs: number): StatsSummary {
  const from = startOfLocalDay(nowMs, range - 1);
  const prevFrom = startOfLocalDay(nowMs, range * 2 - 1);
  const intervals = focusIntervals(data.usage, nowMs);
  const earliestLog = data.usage.reduce((min, t) => Math.min(min, t.at), Infinity);

  const days: DayStat[] = [];
  for (let back = range - 1; back >= 0; back--) {
    const startMs = startOfLocalDay(nowMs, back);
    const endMs = back === 0 ? nowMs : startOfLocalDay(nowMs, back - 1);
    days.push({ date: localDate(startMs), startMs, focusMs: sumOverlap(intervals, startMs, endMs) });
  }

  const started = intervals.filter((i) => i.start >= from);
  const sessionStarts = data.usage.filter((t) => t.kind === 'focusOn' && t.at >= from);
  const scheduled = sessionStarts.filter((t) => t.source === 'schedule').length;

  const today = localDate(nowMs);
  const sites = blockedIn(data.blockedSites, localDate(from), today);
  const prevSites = blockedIn(data.blockedSites, localDate(prevFrom), localDate(from - 1));
  const earliestSiteDay = data.blockedSites[0]?.localDate;

  return {
    rangeStartMs: from,
    focusMs: sumOverlap(intervals, from, nowMs),
    prevFocusMs: earliestLog <= startOfLocalDay(prevFrom, -1) ? sumOverlap(intervals, prevFrom, from) : null,
    days,
    hourGrid: hourGrid(intervals, from, nowMs),
    sessions: started.length,
    longestSessionMs: intervals.reduce((max, i) => Math.max(max, overlap(i, from, nowMs)), 0),
    scheduledShare: sessionStarts.length ? scheduled / sessionStarts.length : null,
    ledger: ledger(data.journal, from, nowMs),
    blockedTotal: sumValues(sites),
    prevBlockedTotal: earliestSiteDay !== undefined && earliestSiteDay <= localDate(prevFrom) ? sumValues(prevSites) : null,
    topSites: [...sites.entries()]
      .map(([host, count]) => ({ host, count }))
      .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host)),
    recent: data.journal
      .filter((e) => e.atMs >= from && FEED_KINDS.has(e.kind.kind))
      .sort((a, b) => b.atMs - a.atMs)
      .slice(0, 8),
  };
}

/** "3 h 20 m", "45 m", "0 m" — compact, for tiles and tooltips. */
export function formatHours(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} m` : `${h} h`;
}

/** Signed percent change, or null when there's nothing to compare against. */
export function percentChange(current: number, previous: number | null): number | null {
  if (previous === null || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
