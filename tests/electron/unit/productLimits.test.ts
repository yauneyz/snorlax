import { describe, expect, it } from 'vitest';
import type { Policy, Profile, ProfileConfig } from '@talysman/shared';
import { EMPTY_POLICY, emptyProfileConfig, palette } from '@talysman/shared';
import {
  constrainConfigToLimits,
  constrainPolicyToLimits,
  constrainProfilesToLimits,
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
  judge: null,
  sites: {},
  apps: [{ windowsImageName: 'chrome.exe', label: 'Chrome' }],
  enabledPremadeLists: [],
};

const schedule: ProfileConfig = {
  ...emptyProfileConfig(),
  schedule: [{ kind: 'window', id: 'w1', days: ['mon'], start: '09:00', end: '17:00', locked: false }],
  oneShots: [{ id: 'o1', atMs: 1, action: 'on', firedAtMs: null }],
};

function profile(id: string, name: string, color: string, policy: Policy): Profile {
  return { id, name, color, createdAtMs: 0, config: { ...emptyProfileConfig(), policy }, latch: { state: 'off' } };
}

const profiles: Profile[] = [
  profile('deep', 'Deep Work', palette.colors.profileAqua, EMPTY_POLICY),
  profile('evening', 'Evening', palette.colors.profileCoral, { ...EMPTY_POLICY, defaultAction: 'block' }),
];

describe('product limits', () => {
  it('ships AI filtering in every environment', () => {
    expect(productFeaturesForEnvironment('development').smartFiltering).toBe(true);
    expect(productFeaturesForEnvironment('production').smartFiltering).toBe(true);
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
    expect(constrainConfigToLimits(schedule, limits)).toEqual(schedule);
  });

  it('gives Free unlimited allow-list websites while keeping apps and schedules gated', () => {
    const limits = limitsForPlan('free');

    expect(validatePolicyForLimits(policy, limits).map((v) => v.field)).toEqual(['policy.apps']);
    expect(validateScheduleForLimits(schedule, limits).map((v) => v.field)).toEqual(['schedule']);

    expect(constrainPolicyToLimits(policy, limits)).toEqual({
      ...policy,
      apps: [],
    });
    // Recurring rules are Pro; one-shot events stay (they add no limits).
    expect(constrainConfigToLimits(schedule, limits)).toEqual({ ...schedule, schedule: [] });
  });

  it('gates premade blocklists behind Pro', () => {
    const limits = limitsForPlan('free');
    const withPremade: Policy = { ...policy, apps: [], enabledPremadeLists: ['shopping'] };

    expect(validatePolicyForLimits(withPremade, limits).map((v) => v.field)).toEqual([
      'policy.enabledPremadeLists',
    ]);
    expect(constrainPolicyToLimits(withPremade, limits)).toEqual({
      ...withPremade,
      enabledPremadeLists: [],
    });
    expect(validatePolicyForLimits(withPremade, limitsForPlan('pro'))).toEqual([]);
  });

  it(`limits only the Free block list to ${FREE_BLOCKED_SITE_LIMIT} websites`, () => {
    const limits = limitsForPlan('free');
    const blockedPolicy: Policy = {
      blockedDomains: policy.allowedDomains,
      allowedDomains: [],
      defaultAction: 'allow',
      judge: null,
      sites: {},
      apps: [],
      enabledPremadeLists: [],
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
      judge: null,
      sites: {},
      apps: [],
      enabledPremadeLists: [],
    };

    expect(validatePolicyForLimits(blockAllPolicy, limits)).toEqual([]);
    expect(constrainPolicyToLimits(blockAllPolicy, limits)).toEqual(blockAllPolicy);
  });

  it('gates AI filtering behind Pro, falling back per the judge policy on Free', () => {
    const limits = limitsForPlan('free');
    const smartPolicy: Policy = {
      blockedDomains: [],
      allowedDomains: [],
      defaultAction: 'judge',
      judge: { tasks: [{ id: 't', title: 'Researching flights to Japan' }], avoid: [], fallback: 'block' },
      apps: [],
      enabledPremadeLists: [],
      sites: { reddit: { features: { content: 'judge' } } },
    };

    expect(validatePolicyForLimits(smartPolicy, limits).map((v) => v.field)).toEqual([
      'policy.judge',
    ]);
    const constrained = constrainPolicyToLimits(smartPolicy, limits);
    expect(constrained.judge).toBeNull();
    expect(constrained.defaultAction).toBe('block');
    expect(constrained.sites.reddit?.features.content).toBe('block');
    expect(validatePolicyForLimits(smartPolicy, limitsForPlan('pro'))).toEqual([]);
  });

  it('counts each site rule toward the Free blocked-website allowance', () => {
    const limits = limitsForPlan('free');
    const sitesPolicy: Policy = {
      ...EMPTY_POLICY,
      blockedDomains: ['a.com', 'b.com', 'c.com', 'd.com'],
      sites: { reddit: { features: {} }, youtube: { features: {} } },
    };
    expect(validatePolicyForLimits(sitesPolicy, limits).map((v) => v.field)).toEqual(['policy.sites']);
    expect(Object.keys(constrainPolicyToLimits(sitesPolicy, limits).sites)).toEqual(['reddit']);
    expect(validatePolicyForLimits({ ...sitesPolicy, blockedDomains: ['a.com'] }, limits)).toEqual([]);
  });
});
