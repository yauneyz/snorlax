import { describe, expect, it } from 'vitest';

import {
  composeCategory,
  normalizeCategory,
  toRegistrableDomain,
} from '../../../scripts/blocklists/normalize.mjs';

describe('blocklist normalization', () => {
  it('preserves tenant ownership boundaries from the private suffix list', () => {
    expect(toRegistrableDomain('alice.github.io')).toBe('alice.github.io');
    expect(toRegistrableDomain('bob.blogspot.com')).toBe('bob.blogspot.com');
    expect(toRegistrableDomain('github.io')).toBeNull();
    expect(toRegistrableDomain('bucket.s3.amazonaws.com')).toBe('bucket.s3.amazonaws.com');
    expect(toRegistrableDomain('amazonaws.com')).toBeNull();
    expect(toRegistrableDomain('BÜCHER.de')).toBe('xn--bcher-kva.de');
  });

  it('composes unions and subtractions before category overrides', () => {
    const first = normalizeCategory([['one.example', 'two.example']], { include: [], exclude: [] });
    const second = normalizeCategory([['three.example']], { include: [], exclude: [] });
    const remove = normalizeCategory([['two.example']], { include: [], exclude: [] });
    expect(
      composeCategory(
        [
          { operation: 'union', domains: first },
          { operation: 'union', domains: second },
          { operation: 'subtract', domains: remove },
        ],
        { include: ['four.example'], exclude: ['one.example'] },
      ),
    ).toEqual(['four.example', 'three.example']);
  });
});
