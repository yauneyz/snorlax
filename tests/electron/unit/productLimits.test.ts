import { describe, expect, it } from 'vitest';
import type { Policy, Profile, Schedule } from '@talysman/shared';
import { EMPTY_POLICY } from '@talysman/shared';
import {
  constrainPolicyToLimits,
  constrainProfilesToLimits,
  constrainScheduleToLimits,
  FREE_BLOCKED_SITE_LIMIT,
  FREE_PROFILE_LIMIT,
  limitsForPlan,
  maxProfiles,
  productFeaturesForEnvironment,
  validatePolicyForLimits,
  validateProfilesForLimits,
  validateScheduleForLimits,
} from '../../../apps/desktop/src/shared/productLimits.js';

const policy: Policy = {
  blockedDomains: [],
  allowedDomains: ['one.com', 'two.com', 'three.com', 'four.com', 'five.com', 'six.com'],
  defaultAction: 'block',
  intent: null,
  apps: [{ windowsImageName: 'chrome.exe', label: 'Chrome' }],
};

const schedule: Schedule = {
  windows: [{ id: 'w1', days: ['mon'], start: '09:00', end: '17:00', locked: false }],
};

const profiles: Profile[] = [
  { id: 'deep', name: 'Deep Work', color: '#4fd6c0', policy: EMPTY_POLICY },
  {
    id: 'evening',
    name: 'Evening',
    color: '#ff8f6b',
    policy: { ...EMPTY_POLICY, defaultAction: 'block' },
  },
];

describe('product limits', () => {
  it('keeps Smart filtering behind the development feature flag', () => {
    expect(productFeaturesForEnvironment('development').smartFiltering).toBe(true);
    expect(productFeaturesForEnvironment('production').smartFiltering).toBe(false);
  });

  it('sets the Free blacklist allowance to five websites', () => {
    expect(FREE_BLOCKED_SITE_LIMIT).toBe(5);
  });

  it('keeps Pro unrestricted by default', () => {
    const limits = limitsForPlan('pro');

    expect(limits).toBeNull();
    expect(validatePolicyForLimits(policy, limits)).toEqual([]);
    expect(validateScheduleForLimits(schedule, limits)).toEqual([]);
    expect(constrainPolicyToLimits(policy, limits)).toBe(policy);
    expect(constrainScheduleToLimits(schedule, limits)).toBe(schedule);
  });

  it('gives Free unlimited allow-list websites while keeping apps and schedules gated', () => {
    const limits = limitsForPlan('free');

    expect(validatePolicyForLimits(policy, limits).map((v) => v.field)).toEqual(['policy.apps']);
    expect(validateScheduleForLimits(schedule, limits).map((v) => v.field)).toEqual(['schedule']);

    expect(constrainPolicyToLimits(policy, limits)).toEqual({
      ...policy,
      apps: [],
    });
    expect(constrainScheduleToLimits(schedule, limits)).toEqual({ windows: [] });
  });

  it(`limits only the Free block list to ${FREE_BLOCKED_SITE_LIMIT} websites`, () => {
    const limits = limitsForPlan('free');
    const blockedPolicy: Policy = {
      blockedDomains: policy.allowedDomains,
      allowedDomains: [],
      defaultAction: 'allow',
      intent: null,
      apps: [],
    };

    expect(validatePolicyForLimits(blockedPolicy, limits).map((v) => v.field)).toEqual([
      'policy.blockedDomains',
    ]);
    expect(constrainPolicyToLimits(blockedPolicy, limits)).toEqual({
      ...blockedPolicy,
      blockedDomains: blockedPolicy.blockedDomains.slice(0, FREE_BLOCKED_SITE_LIMIT),
    });
  });

  it('gives Free one blocking profile and Pro unlimited', () => {
    expect(FREE_PROFILE_LIMIT).toBe(1);
    expect(maxProfiles(limitsForPlan('free'))).toBe(1);
    expect(maxProfiles(limitsForPlan('pro'))).toBeNull();
  });

  it('flags a second profile on Free but not on Pro', () => {
    expect(validateProfilesForLimits(profiles, limitsForPlan('pro'))).toEqual([]);
    expect(validateProfilesForLimits([profiles[0]!], limitsForPlan('free'))).toEqual([]);
    expect(validateProfilesForLimits(profiles, limitsForPlan('free')).map((v) => v.field)).toEqual([
      'profiles',
    ]);
  });

  it('keeps the active profile when trimming to the Free allowance', () => {
    // "evening" is second in the list — a naive slice(0, 1) would drop what is being enforced.
    expect(constrainProfilesToLimits(profiles, 'evening', limitsForPlan('free'))).toEqual([
      profiles[1],
    ]);
    expect(constrainProfilesToLimits(profiles, 'deep', limitsForPlan('free'))).toEqual([
      profiles[0],
    ]);
    expect(constrainProfilesToLimits(profiles, 'deep', limitsForPlan('pro'))).toBe(profiles);
  });

  it('falls back to the first profile when the active id is dangling', () => {
    expect(constrainProfilesToLimits(profiles, 'gone', limitsForPlan('free'))).toEqual([
      profiles[0],
    ]);
  });

  it('allows Free to block everything by default', () => {
    const limits = limitsForPlan('free');
    const blockAllPolicy: Policy = {
      blockedDomains: [],
      allowedDomains: [],
      defaultAction: 'block',
      intent: null,
      apps: [],
    };

    expect(validatePolicyForLimits(blockAllPolicy, limits)).toEqual([]);
    expect(constrainPolicyToLimits(blockAllPolicy, limits)).toEqual(blockAllPolicy);
  });

  it('gates Smart filtering behind Pro', () => {
    const limits = limitsForPlan('free');
    const smartPolicy: Policy = {
      blockedDomains: [],
      allowedDomains: [],
      defaultAction: 'block',
      intent: { positive: 'Researching flights to Japan' },
      apps: [],
    };

    expect(validatePolicyForLimits(smartPolicy, limits).map((v) => v.field)).toEqual([
      'policy.intent',
    ]);
    expect(constrainPolicyToLimits(smartPolicy, limits).intent).toBeNull();
    expect(validatePolicyForLimits(smartPolicy, limitsForPlan('pro'))).toEqual([]);
  });
});
