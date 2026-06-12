import { describe, expect, it } from 'vitest';
import { siblingsFor, expandDomains, PROPERTY_GROUPS } from '@focuslock/core';

describe('siblingsFor', () => {
  it('returns siblings for a known property', () => {
    expect(siblingsFor('reddit.com')).toContain('redditmedia.com');
  });
  it('honors a leading wildcard and case', () => {
    expect(siblingsFor('*.YouTube.com')).toContain('googlevideo.com');
  });
  it('returns [] for an unknown domain', () => {
    expect(siblingsFor('example.com')).toEqual([]);
  });
});

describe('expandDomains', () => {
  it('adds siblings of a listed canonical', () => {
    const out = expandDomains(['reddit.com']);
    expect(out).toContain('reddit.com');
    expect(out).toContain('redditstatic.com');
  });
  it('is order-stable and de-duplicates case-insensitively', () => {
    const out = expandDomains(['Reddit.com', 'redditmedia.com', 'example.com']);
    expect(out[0]).toBe('Reddit.com');
    expect(out.filter((d) => d.toLowerCase() === 'redditmedia.com')).toHaveLength(1);
    expect(out).toContain('example.com');
  });
  it('skips empty entries', () => {
    expect(expandDomains(['', '  '])).toEqual([]);
  });
});

describe('table sanity', () => {
  it('all canonicals and siblings are lowercase and bare', () => {
    for (const [canonical, siblings] of Object.entries(PROPERTY_GROUPS)) {
      expect(canonical).toBe(canonical.toLowerCase());
      expect(canonical.startsWith('*.')).toBe(false);
      for (const s of siblings) {
        expect(s).toBe(s.toLowerCase());
        expect(s.startsWith('*.')).toBe(false);
      }
    }
  });
});
