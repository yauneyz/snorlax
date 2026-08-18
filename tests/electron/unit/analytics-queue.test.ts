import { describe, expect, it } from 'vitest';
import {
  appendCapped,
  MAX_QUEUE_BYTES,
  MAX_QUEUE_EVENTS,
} from '../../../apps/desktop/src/main/analytics.js';

describe('appendCapped (analytics offline queue)', () => {
  it('appends under the caps without dropping anything', () => {
    const result = appendCapped(['a', 'b'], 'c');
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('drops the oldest entries once the event-count cap is exceeded', () => {
    const lines = Array.from({ length: MAX_QUEUE_EVENTS }, (_, i) => `event-${i}`);
    const result = appendCapped(lines, 'newest');

    expect(result).toHaveLength(MAX_QUEUE_EVENTS);
    expect(result[0]).toBe('event-1'); // event-0 dropped
    expect(result[result.length - 1]).toBe('newest');
  });

  it('drops the oldest entries once the byte-size cap is exceeded', () => {
    const bigLine = 'x'.repeat(1024);
    const lines = Array.from({ length: 3000 }, () => bigLine); // ~3MB, over the 2MB cap
    const result = appendCapped(lines, 'newest');

    const totalBytes = result.reduce((n, l) => n + Buffer.byteLength(l, 'utf8') + 1, 0);
    expect(totalBytes).toBeLessThanOrEqual(MAX_QUEUE_BYTES);
    expect(result[result.length - 1]).toBe('newest');
  });

  it('never drops the just-appended line even if it alone exceeds the byte cap', () => {
    const hugeLine = 'x'.repeat(MAX_QUEUE_BYTES + 1000);
    const result = appendCapped([], hugeLine);
    expect(result).toEqual([hugeLine]);
  });
});
