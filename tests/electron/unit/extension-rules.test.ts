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
    // @ts-expect-error — verifies the runtime guard at the untyped extension boundary.
    expect(buildRules(undefined)).toEqual([]);
  });
});

describe('buildRules — blacklist', () => {
  it('blocks subresources and redirects top-level navigation for listed domains', () => {
    const rules = buildRules({ active: true, mode: 'blacklist', domains: ['reddit.com', '*.x.com'] });
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({
      priority: BLOCK_PRIORITY,
      action: { type: 'block' },
      condition: { requestDomains: ['reddit.com', 'x.com'] },
    });
    expect(rules[1]).toMatchObject({
      priority: BLOCK_PRIORITY,
      action: { type: 'redirect', redirect: { extensionPath: '/blocked.html' } },
      condition: {
        requestDomains: ['reddit.com', 'x.com'],
        resourceTypes: ['main_frame'],
      },
    });
  });
  it('produces no rules when the blocklist is empty (nothing to block)', () => {
    expect(buildRules({ active: true, mode: 'blacklist', domains: [] })).toEqual([]);
  });
});

describe('buildRules — whitelist', () => {
  it('default-denies all resource types and allows listed domains at higher priority', () => {
    const rules = buildRules({ active: true, mode: 'whitelist', domains: ['gmail.com'] });
    const block = rules.find((r) => r.action.type === 'block')!;
    const redirect = rules.find((r) => r.action.type === 'redirect')!;
    const allows = rules.filter((r) => r.action.type === 'allow');
    expect(rules).toHaveLength(4);
    expect(block.condition).toEqual({ urlFilter: '*' });
    expect(redirect).toMatchObject({
      action: { type: 'redirect', redirect: { extensionPath: '/blocked.html' } },
      condition: { regexFilter: '^https?://', resourceTypes: ['main_frame'] },
    });
    expect(allows).toEqual([
      expect.objectContaining({
        priority: ALLOW_PRIORITY,
        condition: { requestDomains: ['gmail.com'] },
      }),
      expect.objectContaining({
        priority: ALLOW_PRIORITY,
        condition: { requestDomains: ['gmail.com'], resourceTypes: ['main_frame'] },
      }),
    ]);
    expect(ALLOW_PRIORITY).toBeGreaterThan(BLOCK_PRIORITY);
  });
  it('with an empty allowlist blocks subresources and redirects top-level navigation', () => {
    const rules = buildRules({ active: true, mode: 'whitelist', domains: [] });
    expect(rules).toHaveLength(2);
    expect(rules[0].action).toEqual({ type: 'block' });
    expect(rules[1].action).toEqual({
      type: 'redirect',
      redirect: { extensionPath: '/blocked.html' },
    });
  });
});

describe('buildRules — block-all', () => {
  it('blocks non-navigation requests and redirects top-level HTTP(S) navigation', () => {
    const rules = buildRules({ active: true, mode: 'block-all', domains: ['ignored.com'] });
    expect(rules).toHaveLength(2);
    expect(rules[0].action).toEqual({ type: 'block' });
    expect(rules[0].condition).toEqual({ urlFilter: '*' });
    expect(rules[1]).toMatchObject({
      action: { type: 'redirect', redirect: { extensionPath: '/blocked.html' } },
      condition: { regexFilter: '^https?://', resourceTypes: ['main_frame'] },
    });
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

describe('buildRules — Safari compatibility', () => {
  it('uses one supported urlFilter pair per blacklist domain', () => {
    const rules = buildRules(
      { active: true, mode: 'blacklist', domains: ['reddit.com', '*.x.com'] },
      { safari: true },
    );
    expect(rules).toHaveLength(4);
    expect(rules.map((rule) => rule.condition)).toEqual([
      { urlFilter: '||reddit.com^' },
      { urlFilter: '||reddit.com^', resourceTypes: ['main_frame'] },
      { urlFilter: '||x.com^' },
      { urlFilter: '||x.com^', resourceTypes: ['main_frame'] },
    ]);
    expect(rules.every((rule) => !('requestDomains' in rule.condition))).toBe(true);
  });

  it('uses per-domain Safari allow rules above the whitelist catch-all', () => {
    const rules = buildRules(
      { active: true, mode: 'whitelist', domains: ['gmail.com', 'calendar.google.com'] },
      { safari: true },
    );
    expect(rules).toHaveLength(6);
    expect(rules.slice(2).map((rule) => rule.condition)).toEqual([
      { urlFilter: '||gmail.com^' },
      { urlFilter: '||gmail.com^', resourceTypes: ['main_frame'] },
      { urlFilter: '||calendar.google.com^' },
      { urlFilter: '||calendar.google.com^', resourceTypes: ['main_frame'] },
    ]);
  });
});
