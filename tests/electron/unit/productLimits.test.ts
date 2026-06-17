import { describe, expect, it } from 'vitest';
import type { Policy, Schedule } from '@focuslock/shared';
import {
  constrainPolicyToLimits,
  constrainScheduleToLimits,
  limitsForPlan,
  validatePolicyForLimits,
  validateScheduleForLimits,
} from '../../../apps/desktop/src/shared/productLimits.js';

const policy: Policy = {
  mode: 'whitelist',
  domains: ['one.com', 'two.com', 'three.com', 'four.com', 'five.com', 'six.com'],
  apps: [{ windowsImageName: 'chrome.exe', label: 'Chrome' }],
};

const schedule: Schedule = {
  windows: [{ id: 'w1', days: ['mon'], start: '09:00', end: '17:00', locked: false }],
};

describe('product limits', () => {
  it('keeps Pro unrestricted by default', () => {
    const limits = limitsForPlan('pro');

    expect(limits).toBeNull();
    expect(validatePolicyForLimits(policy, limits)).toEqual([]);
    expect(validateScheduleForLimits(schedule, limits)).toEqual([]);
    expect(constrainPolicyToLimits(policy, limits)).toBe(policy);
    expect(constrainScheduleToLimits(schedule, limits)).toBe(schedule);
  });

  it('limits Free to 5 websites, 0 apps, and no schedule', () => {
    const limits = limitsForPlan('free');

    expect(validatePolicyForLimits(policy, limits).map((v) => v.field)).toEqual([
      'policy.mode',
      'policy.domains',
      'policy.apps',
    ]);
    expect(validateScheduleForLimits(schedule, limits).map((v) => v.field)).toEqual(['schedule']);

    expect(constrainPolicyToLimits(policy, limits)).toEqual({
      mode: 'blacklist',
      domains: ['one.com', 'two.com', 'three.com', 'four.com', 'five.com'],
      apps: [],
    });
    expect(constrainScheduleToLimits(schedule, limits)).toEqual({ windows: [] });
  });

  it('allows Free to use block-all mode', () => {
    const limits = limitsForPlan('free');
    const blockAllPolicy: Policy = { mode: 'block-all', domains: [], apps: [] };

    expect(validatePolicyForLimits(blockAllPolicy, limits)).toEqual([]);
    expect(constrainPolicyToLimits(blockAllPolicy, limits)).toEqual(blockAllPolicy);
  });
});
