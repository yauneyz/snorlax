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
    expect(
      buildRules({ active: false, blockedDomains: [], allowedDomains: [], defaultAction: 'block' }),
    ).toEqual([]);
    // @ts-expect-error — verifies the runtime guard at the untyped extension boundary.
    expect(buildRules(undefined)).toEqual([]);
  });
});

// Equivalent to the old "blacklist" mode: only blockedDomains is populated, defaultAction stays
// 'allow' so nothing outside the hard block list is touched.
describe('buildRules — blockedDomains (classic blacklist equivalent)', () => {
  it('blocks subresources and redirects top-level navigation for listed domains', () => {
    const rules = buildRules({
      active: true,
      blockedDomains: ['reddit.com', '*.x.com'],
      allowedDomains: [],
      defaultAction: 'allow',
    });
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
  it('produces no rules when every list is empty and the default is allow', () => {
    expect(
      buildRules({ active: true, blockedDomains: [], allowedDomains: [], defaultAction: 'allow' }),
    ).toEqual([]);
  });
});

// Equivalent to the old "whitelist" mode: defaultAction 'block' default-denies everything, and
// allowedDomains punches priority-2 allow holes through the priority-1 catch-all block.
describe('buildRules — defaultAction block + allowedDomains (classic whitelist equivalent)', () => {
  it('default-denies all resource types and allows listed domains at higher priority', () => {
    const rules = buildRules({
      active: true,
      blockedDomains: [],
      allowedDomains: ['gmail.com'],
      defaultAction: 'block',
    });
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
    const rules = buildRules({
      active: true,
      blockedDomains: [],
      allowedDomains: [],
      defaultAction: 'block',
    });
    expect(rules).toHaveLength(2);
    expect(rules[0].action).toEqual({ type: 'block' });
    expect(rules[1].action).toEqual({
      type: 'redirect',
      redirect: { extensionPath: '/blocked.html' },
    });
  });
});

// Equivalent to the old "block-all" mode: both lists empty, defaultAction 'block'.
describe('buildRules — defaultAction block, empty lists (classic block-all equivalent)', () => {
  it('blocks non-navigation requests and redirects top-level HTTP(S) navigation', () => {
    const rules = buildRules({
      active: true,
      blockedDomains: [],
      allowedDomains: [],
      defaultAction: 'block',
    });
    expect(rules).toHaveLength(2);
    expect(rules[0].action).toEqual({ type: 'block' });
    expect(rules[0].condition).toEqual({ urlFilter: '*' });
    expect(rules[1]).toMatchObject({
      action: { type: 'redirect', redirect: { extensionPath: '/blocked.html' } },
      condition: { regexFilter: '^https?://', resourceTypes: ['main_frame'] },
    });
  });
});

// New combinations that only make sense post-Smart-filtering: blockedDomains and defaultAction
// interact independently of allowedDomains.
describe('buildRules — Smart filtering shapes', () => {
  it('defaultAction allow blocks the hard blocklist but adds no rules for allowedDomains', () => {
    const rules = buildRules({
      active: true,
      blockedDomains: ['reddit.com'],
      allowedDomains: ['gmail.com'],
      defaultAction: 'allow',
    });
    // Only the blockedDomains block+redirect pair — allowedDomains are already implicitly allowed
    // by the default and must not generate DNR allow rules (there's nothing to punch a hole in).
    expect(rules).toHaveLength(2);
    expect(rules.every((r) => r.action.type !== 'allow')).toBe(true);
    expect(rules[0].condition).toEqual({ requestDomains: ['reddit.com'] });
  });

  it('defaultAction block combines the hard blocklist with the default-deny + allow pattern', () => {
    const rules = buildRules({
      active: true,
      blockedDomains: ['reddit.com'],
      allowedDomains: ['gmail.com'],
      defaultAction: 'block',
    });
    // blockedDomains pair, then catch-all block/redirect, then allowedDomains allow pair.
    expect(rules).toHaveLength(6);
    expect(rules[0].action).toEqual({ type: 'block' });
    expect(rules[0].condition).toEqual({ requestDomains: ['reddit.com'] });
    expect(rules[2].condition).toEqual({ urlFilter: '*' });
    expect(rules.filter((r) => r.action.type === 'allow')).toHaveLength(2);
  });
});

describe('buildRules — unique rule ids', () => {
  it('never emits duplicate ids within a ruleset', () => {
    const shapes = [
      { blockedDomains: ['a.com', 'b.com'], allowedDomains: [], defaultAction: 'allow' as const },
      { blockedDomains: [], allowedDomains: ['a.com', 'b.com'], defaultAction: 'block' as const },
      { blockedDomains: [], allowedDomains: [], defaultAction: 'block' as const },
      { blockedDomains: ['a.com'], allowedDomains: ['b.com'], defaultAction: 'block' as const },
    ];
    for (const shape of shapes) {
      const rules = buildRules({ active: true, ...shape });
      const ids = rules.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
