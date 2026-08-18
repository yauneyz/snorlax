import { describe, expect, it } from 'vitest';
import { rollupUsage } from '@talysman/core';
import type { UsageTransition } from '@talysman/shared';

function transition(
  seq: number,
  at: number,
  kind: UsageTransition['kind'],
  source: UsageTransition['source'] = 'user',
): UsageTransition {
  return { seq, at, kind, source };
}

describe('rollupUsage', () => {
  it('splits a session that crosses local midnight across both dates', () => {
    const on = Date.UTC(2024, 0, 7, 22, 0, 0); // 2024-01-07T22:00:00Z
    const off = Date.UTC(2024, 0, 8, 2, 0, 0); // 2024-01-08T02:00:00Z
    const now = new Date(Date.UTC(2024, 0, 8, 3, 0, 0));

    const rows = rollupUsage(
      [transition(1, on, 'focusOn'), transition(2, off, 'focusOff')],
      0,
      0,
      now,
      'linux',
      '0.4.0',
    );

    const jan7 = rows.find((r) => r.local_date === '2024-01-07');
    const jan8 = rows.find((r) => r.local_date === '2024-01-08');
    expect(jan7?.focus_seconds).toBe(2 * 3600);
    expect(jan8?.focus_seconds).toBe(2 * 3600);
  });

  it('treats a trailing unterminated focusOn as still-on through now', () => {
    const on = Date.UTC(2024, 0, 7, 10, 0, 0);
    const now = new Date(Date.UTC(2024, 0, 7, 11, 0, 0));

    const rows = rollupUsage([transition(1, on, 'focusOn')], 2, 0, now, 'linux', '0.4.0');

    const jan7 = rows.find((r) => r.local_date === '2024-01-07');
    expect(jan7?.focus_seconds).toBe(3600);
    expect(jan7?.app_opens).toBe(2);
  });

  it('contributes nothing from a trailing focusOn when the clock has jumped backwards', () => {
    const on = Date.UTC(2024, 0, 7, 10, 0, 0);
    const now = new Date(Date.UTC(2024, 0, 7, 9, 0, 0)); // before `on`

    const rows = rollupUsage([transition(1, on, 'focusOn')], 0, 0, now, 'linux', '0.4.0');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.local_date).toBe('2024-01-07');
    expect(rows[0]?.focus_seconds).toBe(0);
  });

  it('always includes today even with an empty transition log', () => {
    const now = new Date(Date.UTC(2024, 0, 7, 12, 0, 0));
    const rows = rollupUsage([], 1, 0, now, 'linux', '0.4.0');
    expect(rows).toEqual([
      {
        local_date: '2024-01-07',
        platform: 'linux',
        app_version: '0.4.0',
        focus_seconds: 0,
        key_present_seconds: 0,
        app_opens: 1,
      },
    ]);
  });

  it('rolls up keyPresent/keyAbsent pairs into key_present_seconds independently of focus', () => {
    const keyIn = Date.UTC(2024, 0, 7, 9, 0, 0);
    const keyOut = Date.UTC(2024, 0, 7, 9, 30, 0);
    const now = new Date(Date.UTC(2024, 0, 7, 10, 0, 0));

    const rows = rollupUsage(
      [transition(1, keyIn, 'keyPresent'), transition(2, keyOut, 'keyAbsent')],
      0,
      0,
      now,
      'linux',
      '0.4.0',
    );

    const jan7 = rows.find((r) => r.local_date === '2024-01-07');
    expect(jan7?.key_present_seconds).toBe(30 * 60);
    expect(jan7?.focus_seconds).toBe(0);
  });

  it('applies a non-zero timezone offset when bucketing by local date', () => {
    // 23:30 UTC on 2024-01-07 is 2024-01-08 07:30 in UTC+8.
    const on = Date.UTC(2024, 0, 7, 23, 30, 0);
    const off = Date.UTC(2024, 0, 7, 23, 45, 0);
    const now = new Date(Date.UTC(2024, 0, 8, 0, 0, 0));

    const rows = rollupUsage(
      [transition(1, on, 'focusOn'), transition(2, off, 'focusOff')],
      0,
      480,
      now,
      'linux',
      '0.4.0',
    );

    expect(rows.find((r) => r.local_date === '2024-01-08')?.focus_seconds).toBe(15 * 60);
    expect(rows.find((r) => r.local_date === '2024-01-07')).toBeUndefined();
  });
});
