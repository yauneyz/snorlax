import { describe, expect, it } from 'vitest';
import { prepareDomainPaste } from '../../../apps/desktop/src/renderer/lib/domainPaste.js';

describe('domain paste results', () => {
  it('accounts for normalized duplicates, invalid entries and the available slots', () => {
    const raw = [
      'HTTPS://REDDIT.COM/r/test',
      'youtube.com',
      'YouTube.com',
      'invalid',
      'news.com',
      'other.com',
    ];
    const result = prepareDomainPaste(raw, ['reddit.com'], 1);
    expect(result).toEqual({ additions: ['youtube.com'], duplicates: 2, invalid: 1, overLimit: 2 });
    expect(result.additions.length + result.duplicates + result.invalid + result.overLimit).toBe(
      raw.length,
    );
  });

  it('never admits entries when the shared blocked allowance is already exceeded', () => {
    expect(prepareDomainPaste(['one.com', 'two.com'], [], -2)).toEqual({
      additions: [],
      duplicates: 0,
      invalid: 0,
      overLimit: 2,
    });
  });

  it('allows unlimited entries and counts repeats beyond the limit only once as over-limit', () => {
    expect(prepareDomainPaste(['one.com', 'two.com'], [], Infinity).additions).toEqual([
      'one.com',
      'two.com',
    ]);
    expect(prepareDomainPaste(['one.com', 'one.com'], [], 0)).toEqual({
      additions: [],
      duplicates: 1,
      invalid: 0,
      overLimit: 1,
    });
  });
});
