import { describe, expect, it } from 'vitest';
import { evaluateSchedule, parseHm, windowCovers } from '@talysman/core';
import type { Schedule, ScheduleWindow } from '@talysman/shared';

function at(day: number, h: number, m = 0): Date {
  // 2024-01-07 is a Sunday; add `day` days to land on the desired weekday.
  return new Date(2024, 0, 7 + day, h, m, 0);
}

const win = (over: Partial<ScheduleWindow> = {}): ScheduleWindow => ({
  id: 'w1',
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  start: '09:00',
  end: '17:00',
  locked: false,
  ...over,
});

describe('parseHm', () => {
  it('parses valid times', () => {
    expect(parseHm('00:00')).toBe(0);
    expect(parseHm('09:30')).toBe(570);
    expect(parseHm('23:59')).toBe(1439);
  });
  it('rejects malformed times', () => {
    expect(parseHm('24:00')).toBeNull();
    expect(parseHm('9:00')).toBeNull();
    expect(parseHm('garbage')).toBeNull();
  });
});

describe('windowCovers', () => {
  it('matches within a same-day window', () => {
    expect(windowCovers(win(), 'mon', 10 * 60)).toBe(true);
    expect(windowCovers(win(), 'mon', 8 * 60)).toBe(false);
    expect(windowCovers(win(), 'sat', 10 * 60)).toBe(false);
  });
  it('end is exclusive', () => {
    expect(windowCovers(win({ end: '17:00' }), 'mon', 17 * 60)).toBe(false);
    expect(windowCovers(win({ end: '17:00' }), 'mon', 17 * 60 - 1)).toBe(true);
  });
  it('handles overnight windows', () => {
    const overnight = win({ days: ['fri'], start: '22:00', end: '02:00' });
    expect(windowCovers(overnight, 'fri', 23 * 60)).toBe(true); // fri night
    expect(windowCovers(overnight, 'sat', 1 * 60)).toBe(true); // sat early morning
    expect(windowCovers(overnight, 'sat', 3 * 60)).toBe(false);
    expect(windowCovers(overnight, 'sun', 1 * 60)).toBe(false);
  });
});

describe('evaluateSchedule', () => {
  it('is inactive with no windows', () => {
    const s: Schedule = { windows: [] };
    expect(evaluateSchedule(s, at(1, 10)).active).toBe(false);
  });
  it('activates during a window', () => {
    const s: Schedule = { windows: [win()] };
    const r = evaluateSchedule(s, at(1, 10)); // Monday 10:00
    expect(r.active).toBe(true);
    expect(r.windowId).toBe('w1');
    expect(r.locked).toBe(false);
  });
  it('reports locked when a covering window is locked', () => {
    const s: Schedule = { windows: [win({ id: 'a' }), win({ id: 'b', locked: true })] };
    const r = evaluateSchedule(s, at(1, 10));
    expect(r.active).toBe(true);
    expect(r.locked).toBe(true);
    expect(r.windowId).toBe('b');
  });

  it('reports the profile the covering window switches to', () => {
    const s: Schedule = { windows: [win({ profileId: 'deep' })] };
    expect(evaluateSchedule(s, at(1, 10)).profileId).toBe('deep');
  });

  it('leaves the profile undefined when the window names none', () => {
    const s: Schedule = { windows: [win()] };
    expect(evaluateSchedule(s, at(1, 10)).profileId).toBeUndefined();
  });

  it('prefers the locked window’s profile when windows overlap', () => {
    const s: Schedule = {
      windows: [
        win({ id: 'a', profileId: 'lax' }),
        win({ id: 'b', locked: true, profileId: 'strict' }),
      ],
    };
    expect(evaluateSchedule(s, at(1, 10)).profileId).toBe('strict');
  });
});
