import { describe, it, expect } from 'vitest';
// The extension's rule logic is plain ESM JS (no chrome.* calls) so it runs under vitest directly.
import {
  buildRules,
  normalizeDomain,
  normalizeDomains,
  BLOCK_PRIORITY,
  ALLOW_PRIORITY,
} from '../../../apps/extension/src/rules.js';

describe('normalizeDomain', () => {
  it('strips a leading wildcard, lowercases, drops a trailing dot', () => {
    expect(normalizeDomain('*.Reddit.com')).toBe('reddit.com');
    expect(normalizeDomain('YouTube.com.')).toBe('youtube.com');
    expect(normalizeDomain('  example.com  ')).toBe('example.com');
  });
  it('returns null for empties', () => {
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain('*.')).toBeNull();
  });
});

describe('normalizeDomains', () => {
  it('dedupes after normalization', () => {
    expect(normalizeDomains(['reddit.com', '*.reddit.com', 'REDDIT.com'])).toEqual(['reddit.com']);
  });
});

describe('buildRules — focus off', () => {
  it('blocks nothing while unlocked', () => {
    expect(buildRules({ active: false, mode: 'block-all', domains: [] })).toEqual([]);
    expect(buildRules(undefined as any)).toEqual([]);
  });
});

describe('buildRules — blacklist', () => {
  it('blocks the listed domains via requestDomains (subdomain-aware)', () => {
    const rules = buildRules({ active: true, mode: 'blacklist', domains: ['reddit.com', '*.x.com'] });
    expect(rules).toHaveLength(1);
    expect(rules[0].action).toEqual({ type: 'block' });
    expect(rules[0].condition).toEqual({ requestDomains: ['reddit.com', 'x.com'] });
    expect(rules[0].priority).toBe(BLOCK_PRIORITY);
  });
  it('produces no rules when the blocklist is empty (nothing to block)', () => {
    expect(buildRules({ active: true, mode: 'blacklist', domains: [] })).toEqual([]);
  });
});

describe('buildRules — whitelist', () => {
  it('default-denies all and allows the listed domains at higher priority', () => {
    const rules = buildRules({ active: true, mode: 'whitelist', domains: ['gmail.com'] });
    const block = rules.find((r) => r.action.type === 'block')!;
    const allow = rules.find((r) => r.action.type === 'allow')!;
    expect(block.condition).toEqual({ urlFilter: '*' });
    expect(allow.condition).toEqual({ requestDomains: ['gmail.com'] });
    expect(allow.priority).toBeGreaterThan(block.priority);
    expect(allow.priority).toBe(ALLOW_PRIORITY);
  });
  it('with an empty allowlist blocks everything (no allow rule)', () => {
    const rules = buildRules({ active: true, mode: 'whitelist', domains: [] });
    expect(rules).toHaveLength(1);
    expect(rules[0].action).toEqual({ type: 'block' });
  });
});

describe('buildRules — block-all', () => {
  it('blocks every request', () => {
    const rules = buildRules({ active: true, mode: 'block-all', domains: ['ignored.com'] });
    expect(rules).toHaveLength(1);
    expect(rules[0].action).toEqual({ type: 'block' });
    expect(rules[0].condition).toEqual({ urlFilter: '*' });
  });
});

describe('buildRules — unique rule ids', () => {
  it('never emits duplicate ids within a ruleset', () => {
    for (const mode of ['blacklist', 'whitelist', 'block-all'] as const) {
      const rules = buildRules({ active: true, mode, domains: ['a.com', 'b.com'] });
      const ids = rules.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
