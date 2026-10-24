import { describe, expect, it } from 'vitest';
import type { JournalEntry, StatsData, UsageTransition } from '@talysman/shared';
import { focusIntervals, localDate, summarize } from '../../../apps/desktop/src/renderer/lib/stats.js';
import { MockServiceConnection } from '../../helpers/mockService.js';

const HOUR = 60 * 60 * 1000;
// A Wednesday, 18:00 local time.
const NOW = new Date(2026, 9, 21, 18, 0, 0).getTime();
const at = (daysBack: number, hour: number) => new Date(2026, 9, 21 - daysBack, hour, 0, 0).getTime();

let seq = 0;
function t(atMs: number, kind: UsageTransition['kind'], source: UsageTransition['source'] = 'user'): UsageTransition {
  return { seq: ++seq, at: atMs, kind, source };
}

function entry(atMs: number, kind: JournalEntry['kind'], breaksStreak = false): JournalEntry {
  return { id: `d:${++seq}`, deviceId: 'd', seq, atMs, localDate: localDate(atMs), breaksStreak, kind };
}

function data(partial: Partial<StatsData>): StatsData {
  return { usage: [], journal: [], blockedSites: [], ...partial };
}

describe('focusIntervals', () => {
  it('pairs on/off and keeps a trailing session open through now', () => {
    const intervals = focusIntervals([t(at(0, 9), 'focusOn'), t(at(0, 11), 'focusOff'), t(at(0, 17), 'focusOn')], NOW);
    expect(intervals).toEqual([
      { start: at(0, 9), end: at(0, 11) },
      { start: at(0, 17), end: NOW },
    ]);
  });

  it('does not count downtime between a restart’s repeated focusOn', () => {
    // On at 9, key plugged in at 10, service restarted (re-armed) at 15, off at 16.
    const intervals = focusIntervals(
      [t(at(0, 9), 'focusOn'), t(at(0, 10), 'keyPresent', 'boot'), t(at(0, 15), 'focusOn'), t(at(0, 16), 'focusOff')],
      NOW,
    );
    expect(intervals).toEqual([
      { start: at(0, 9), end: at(0, 10) },
      { start: at(0, 15), end: at(0, 16) },
    ]);
  });
});

describe('summarize', () => {
  it('buckets focus by day and hour, and clips sessions to the range', () => {
    const summary = summarize(
      data({
        usage: [
          t(at(7, 22), 'focusOn', 'schedule'), // crosses into the 7-day range at midnight
          t(at(6, 2), 'focusOff'),
          t(at(0, 9), 'focusOn'),
          t(at(0, 12), 'focusOff'),
        ],
      }),
      7,
      NOW,
    );
    expect(summary.days).toHaveLength(7);
    expect(summary.days[0]!.focusMs).toBe(2 * HOUR);
    expect(summary.days[6]!.focusMs).toBe(3 * HOUR);
    expect(summary.focusMs).toBe(5 * HOUR);
    expect(summary.sessions).toBe(1);
    expect(summary.longestSessionMs).toBe(3 * HOUR);
    // Today is a Wednesday (index 2); 9–12 is three full hours.
    expect(summary.hourGrid[2]!.slice(9, 12)).toEqual([HOUR, HOUR, HOUR]);
    expect(summary.scheduledShare).toBe(0);
  });

  it('only compares against the previous period when the log reaches back that far', () => {
    const recent = summarize(data({ usage: [t(at(1, 9), 'focusOn'), t(at(1, 10), 'focusOff')] }), 7, NOW);
    expect(recent.prevFocusMs).toBeNull();
    const longer = summarize(
      data({ usage: [t(at(13, 9), 'focusOn'), t(at(13, 11), 'focusOff'), t(at(1, 9), 'focusOn'), t(at(1, 10), 'focusOff')] }),
      7,
      NOW,
    );
    expect(longer.prevFocusMs).toBe(2 * HOUR);
  });

  it('tallies unlocks and pauses with their durations', () => {
    const summary = summarize(
      data({
        journal: [
          entry(at(1, 10), { kind: 'poolUnlocked', pools: [], minutes: 15 }),
          entry(at(1, 11), { kind: 'overrideStarted', override: 'timed' }, true),
          entry(at(1, 12), { kind: 'overrideEnded', override: 'timed' }),
          entry(at(0, 9), { kind: 'overrideStarted', override: 'allOff' }, true),
          entry(at(0, 10), { kind: 'reenabledAll' }),
          entry(at(0, 11), { kind: 'emergencyUsed' }, true),
          entry(at(20, 11), { kind: 'emergencyUsed' }, true),
        ],
      }),
      7,
      NOW,
    );
    expect(summary.ledger).toMatchObject({
      poolUnlocks: 1,
      poolMinutes: 15,
      pauses: 1,
      pausedMs: HOUR,
      turnedOff: 1,
      turnedOffMs: HOUR,
      emergencies: 1,
    });
    expect(summary.recent[0]!.kind.kind).toBe('emergencyUsed');
  });

  it('ranks blocked sites within the range', () => {
    const summary = summarize(
      data({
        blockedSites: [
          { localDate: localDate(at(13, 9)), hosts: { 'old.com': 50 } },
          { localDate: localDate(at(1, 9)), hosts: { 'reddit.com': 3, 'youtube.com': 1 } },
          { localDate: localDate(at(0, 9)), hosts: { 'youtube.com': 4 } },
        ],
      }),
      7,
      NOW,
    );
    expect(summary.topSites).toEqual([
      { host: 'youtube.com', count: 5 },
      { host: 'reddit.com', count: 3 },
    ]);
    expect(summary.blockedTotal).toBe(8);
    expect(summary.prevBlockedTotal).toBe(50);
  });
});

describe('mock service blocked-site stats', () => {
  it('records nothing until opted in, and turning off deletes what was recorded', async () => {
    const svc = new MockServiceConnection();
    await svc.request('recordBlockedSite', { host: 'reddit.com' });
    expect((await svc.request('getStats', undefined)).blockedSites).toEqual([]);

    await svc.request('setBlockedSiteStatsEnabled', { enabled: true });
    await svc.request('recordBlockedSite', { host: 'www.reddit.com' });
    await svc.request('recordBlockedSite', { host: 'reddit.com' });
    expect((await svc.request('getStats', undefined)).blockedSites[0]!.hosts).toEqual({ 'reddit.com': 2 });

    await svc.request('setBlockedSiteStatsEnabled', { enabled: false });
    await svc.request('setBlockedSiteStatsEnabled', { enabled: true });
    expect((await svc.request('getStats', undefined)).blockedSites).toEqual([]);
  });
});
