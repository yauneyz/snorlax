import { describe, expect, it } from 'vitest';
import type { Policy, Profile, RuleAction } from '@talysman/shared';
import { EMPTY_POLICY, SITE_DEFINITIONS, emptyProfileConfig } from '@talysman/shared';
import { policyHasJudgeRule } from '@talysman/product';
import { effectiveSmartFiltering, resolveAiModeEnabled } from '../../../apps/desktop/src/main/aiModePolicy.js';
import { decide } from '../../../apps/extension/src/site-engine.js';

const JUDGE: Policy['judge'] = { tasks: [{ id: 't1', title: 'Write the thesis' }], avoid: ['sports'], fallback: 'block' };

function profile(policy: Partial<Policy>): Profile {
  return {
    id: 'p',
    name: 'P',
    color: 'test-color',
    createdAtMs: 0,
    config: { ...emptyProfileConfig(), policy: { ...EMPTY_POLICY, ...policy } },
    latch: { state: 'off' },
  };
}

describe('policyHasJudgeRule', () => {
  it('ignores tasks that no rule uses', () => {
    expect(policyHasJudgeRule({ ...EMPTY_POLICY, judge: JUDGE })).toBe(false);
  });

  it('counts a judged default', () => {
    expect(policyHasJudgeRule({ ...EMPTY_POLICY, judge: JUDGE, defaultAction: 'judge' })).toBe(true);
  });

  it('counts a judged site feature', () => {
    const reddit = SITE_DEFINITIONS.find((site) => site.id === 'reddit')!;
    const feature = reddit.features.find((f) => !f.locked)!;
    const policy = { ...EMPTY_POLICY, sites: { reddit: { features: { [feature.id]: 'judge' as RuleAction } } } };
    expect(policyHasJudgeRule(policy)).toBe(true);
  });
});

describe('resolveAiModeEnabled', () => {
  it('defaults off', () => {
    expect(resolveAiModeEnabled(undefined, [profile({})])).toBe(false);
    expect(resolveAiModeEnabled(undefined, [profile({ judge: JUDGE })])).toBe(false);
  });

  it('defaults on for existing users with an active AI rule', () => {
    expect(resolveAiModeEnabled(undefined, [profile({}), profile({ judge: JUDGE, defaultAction: 'judge' })])).toBe(true);
  });

  it('honours an explicit choice either way', () => {
    expect(resolveAiModeEnabled(false, [profile({ judge: JUDGE, defaultAction: 'judge' })])).toBe(false);
    expect(resolveAiModeEnabled(true, [profile({})])).toBe(true);
  });
});

describe('effectiveSmartFiltering', () => {
  it('needs both the build flag and the user choice', () => {
    expect(effectiveSmartFiltering(true, true)).toBe(true);
    expect(effectiveSmartFiltering(true, false)).toBe(false);
    expect(effectiveSmartFiltering(false, true)).toBe(false);
  });
});

describe('extension decisions without AI rules', () => {
  const urls = [
    'https://example.com/',
    'https://mail.google.com/',
    'https://www.reddit.com/',
    'https://www.reddit.com/r/rust/comments/abc/some_post/',
    'https://unlisted.test/page',
  ];

  for (const defaultAction of ['allow', 'block'] as const) {
    it(`are identical with or without a task list (default ${defaultAction})`, () => {
      const base = {
        active: true,
        blockedDomains: ['example.com'],
        allowedDomains: ['mail.google.com'],
        defaultAction,
        sites: { reddit: { features: { feed: 'block' as RuleAction } } },
      };
      for (const url of urls) {
        expect(decide({ ...base, judge: JUDGE }, url)).toEqual(decide({ ...base, judge: null }, url));
      }
    });
  }
});
