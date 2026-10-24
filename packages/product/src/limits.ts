import type { Policy, Profile, ProfileConfig } from '@talysman/shared';
import { siteRuleUsesJudge } from '@talysman/shared';
import type { SubscriptionPlan } from './entitlements.js';

export const FREE_BLOCKED_SITE_LIMIT = 5;
/** Free keeps a single blocking profile; Pro is unlimited. */
export const FREE_PROFILE_LIMIT = 1;

type LimitedValue = number | null;

export interface ProductLimits {
  policy?: {
    maxBlockedDomains?: LimitedValue;
    maxAllowedDomains?: LimitedValue;
    maxApps?: LimitedValue;
    /** AI filtering (`Policy.judge` and any `judge` action) has real per-page LLM cost — Pro-only. */
    smartFilteringEnabled?: boolean;
    /** Built-in bulk category blocklists (`Policy.enabledPremadeLists`) — Pro-only. */
    premadeListsEnabled?: boolean;
  };
  profiles?: {
    max?: LimitedValue;
  };
  schedule?: {
    enabled?: boolean;
  };
}

export interface LimitViolation {
  field:
    | 'policy.blockedDomains'
    | 'policy.allowedDomains'
    | 'policy.sites'
    | 'policy.judge'
    | 'policy.apps'
    | 'policy.enabledPremadeLists'
    | 'profiles'
    | 'schedule';
  message: string;
}

const FREE_LIMITS: ProductLimits = {
  policy: {
    // Only the block list was ever rate-limited on Free; the allow list (old "whitelist" mode)
    // has always been unlimited there — carried forward unchanged. Site rules share this
    // allowance: each enabled site counts as one blocked website.
    maxBlockedDomains: FREE_BLOCKED_SITE_LIMIT,
    maxApps: 0,
    smartFilteringEnabled: false,
    premadeListsEnabled: false,
  },
  profiles: {
    max: FREE_PROFILE_LIMIT,
  },
  schedule: {
    enabled: false,
  },
};

export function limitsForPlan(plan: SubscriptionPlan): ProductLimits | null {
  return plan === 'free' ? FREE_LIMITS : null;
}

export function isScheduleEnabled(limits: ProductLimits | null): boolean {
  return limits?.schedule?.enabled !== false;
}

export function smartFilteringAllowed(limits: ProductLimits | null): boolean {
  return limits?.policy?.smartFilteringEnabled !== false;
}

export function premadeListsAllowed(limits: ProductLimits | null): boolean {
  return limits?.policy?.premadeListsEnabled !== false;
}

export function maxBlockedDomains(limits: ProductLimits | null): LimitedValue {
  return limits?.policy?.maxBlockedDomains ?? null;
}

export function maxAllowedDomains(limits: ProductLimits | null): LimitedValue {
  return limits?.policy?.maxAllowedDomains ?? null;
}

export function maxPolicyApps(limits: ProductLimits | null): LimitedValue {
  return limits?.policy?.maxApps ?? null;
}

/** How many blocking profiles the plan allows; null means unlimited. */
export function maxProfiles(limits: ProductLimits | null): LimitedValue {
  return limits?.profiles?.max ?? null;
}

/** Whether the policy asks the AI judge for anything. */
export function policyUsesJudge(policy: Policy): boolean {
  return policy.universalSoftBlock === true || policy.judge !== null
    || policy.defaultAction === 'judge'
    || Object.entries(policy.sites ?? {}).some(([id, rule]) => siteRuleUsesJudge(id, rule));
}

/**
 * Whether any rule actually sends pages to the AI judge — a judged default or a judged site
 * feature, or universal region discovery. Tasks alone are inert.
 */
export function policyHasJudgeRule(policy: Policy): boolean {
  return policy.universalSoftBlock === true || policy.defaultAction === 'judge'
    || Object.entries(policy.sites ?? {}).some(([id, rule]) => siteRuleUsesJudge(id, rule));
}

export function validatePolicyForLimits(
  policy: Policy,
  limits: ProductLimits | null,
): LimitViolation[] {
  if (!limits?.policy) return [];

  const violations: LimitViolation[] = [];
  const maxBlocked = maxBlockedDomains(limits);
  const maxAllowed = maxAllowedDomains(limits);
  const maxApps = maxPolicyApps(limits);

  const siteCount = Object.keys(policy.sites ?? {}).length;
  if (maxBlocked !== null && policy.blockedDomains.length + siteCount > maxBlocked) {
    violations.push({
      field: siteCount > 0 && policy.blockedDomains.length <= maxBlocked ? 'policy.sites' : 'policy.blockedDomains',
      message: `Free supports up to ${maxBlocked} blocked websites, including site rules.`,
    });
  }

  if (maxAllowed !== null && policy.allowedDomains.length > maxAllowed) {
    violations.push({
      field: 'policy.allowedDomains',
      message: `Free supports up to ${maxAllowed} always-allowed websites.`,
    });
  }

  if (policyUsesJudge(policy) && !smartFilteringAllowed(limits)) {
    violations.push({
      field: 'policy.judge',
      message: 'AI filtering is a Pro feature.',
    });
  }

  if (maxApps !== null && policy.apps.length > maxApps) {
    violations.push({
      field: 'policy.apps',
      message: 'Free does not include app blocking.',
    });
  }

  if (policy.enabledPremadeLists.length > 0 && !premadeListsAllowed(limits)) {
    violations.push({
      field: 'policy.enabledPremadeLists',
      message: 'Premade blocklists are a Pro feature.',
    });
  }

  return violations;
}

export function validateProfilesForLimits(
  profiles: readonly unknown[],
  limits: ProductLimits | null,
): LimitViolation[] {
  const max = maxProfiles(limits);
  if (max === null || profiles.length <= max) return [];
  return [
    {
      field: 'profiles',
      message:
        max === 1
          ? 'Free includes one blocking profile. Upgrade for unlimited profiles.'
          : `Free supports up to ${max} blocking profiles.`,
    },
  ];
}

/**
 * Recurring schedule rules (windows, "on at"/"off at") are Pro. One-shot events, pools,
 * overrides, streaks and emergency unlocks add no limits (spec §3.11).
 */
export function validateScheduleForLimits(
  config: Pick<ProfileConfig, 'schedule'>,
  limits: ProductLimits | null,
): LimitViolation[] {
  if (isScheduleEnabled(limits) || config.schedule.length === 0) return [];
  return [{ field: 'schedule', message: 'Free does not include scheduling.' }];
}

/** Every plan-limit violation of one profile's config. */
export function validateConfigForLimits(config: ProfileConfig, limits: ProductLimits | null): LimitViolation[] {
  return [...validatePolicyForLimits(config.policy, limits), ...validateScheduleForLimits(config, limits)];
}

export function constrainPolicyToLimits(policy: Policy, limits: ProductLimits | null): Policy {
  if (!limits?.policy) return policy;

  const maxBlocked = maxBlockedDomains(limits);
  const maxAllowed = maxAllowedDomains(limits);
  const maxApps = maxPolicyApps(limits);

  const blockedDomains =
    maxBlocked === null ? policy.blockedDomains : policy.blockedDomains.slice(0, maxBlocked);
  // Sites fill whatever blocked-website allowance the hard blocks leave, in order.
  const siteEntries = Object.entries(policy.sites ?? {});
  let sites = Object.fromEntries(
    maxBlocked === null ? siteEntries : siteEntries.slice(0, Math.max(0, maxBlocked - blockedDomains.length)),
  );
  let defaultAction = policy.defaultAction;
  let judge = policy.judge;
  if (!smartFilteringAllowed(limits)) {
    judge = null;
    if (defaultAction === 'judge') defaultAction = policy.judge?.fallback ?? 'allow';
    // A judged feature falls back to what AI filtering would have fallen back to.
    const fallback = policy.judge?.fallback ?? 'allow';
    sites = Object.fromEntries(Object.entries(sites).map(([id, rule]) => [id, {
      features: Object.fromEntries(Object.entries(rule.features).map(([feature, action]) => [feature, action === 'judge' ? fallback : action])),
    }]));
  }

  return {
    ...policy,
    ...(policy.universalSoftBlock && !smartFilteringAllowed(limits) ? { universalSoftBlock: false } : {}),
    blockedDomains,
    allowedDomains:
      maxAllowed === null ? policy.allowedDomains : policy.allowedDomains.slice(0, maxAllowed),
    defaultAction,
    judge,
    sites,
    apps: maxApps === null ? policy.apps : policy.apps.slice(0, maxApps),
    enabledPremadeLists: premadeListsAllowed(limits) ? policy.enabledPremadeLists : [],
  };
}

/** One profile's config trimmed to the plan: capped policy, no recurring schedule on Free. */
export function constrainConfigToLimits(config: ProfileConfig, limits: ProductLimits | null): ProfileConfig {
  return {
    ...config,
    policy: constrainPolicyToLimits(config.policy, limits),
    schedule: isScheduleEnabled(limits) ? config.schedule : [],
  };
}

/**
 * Trim the profile set to the plan's allowance. `keepId` (the default profile, or whichever is
 * enforcing) is always kept — a downgrade must never silently swap out what is being enforced
 * right now. The returned profiles are otherwise order-stable.
 */
export function constrainProfilesToLimits<P extends Pick<Profile, 'id'>>(
  profiles: readonly P[],
  keepId: string | null | undefined,
  limits: ProductLimits | null,
): P[] {
  const max = maxProfiles(limits);
  if (max === null || profiles.length <= max) return profiles as P[];
  if (max <= 0) return profiles.slice(0, 1);

  const keep = profiles.find((p) => p.id === keepId) ?? profiles[0];
  const kept = profiles.filter((p) => p.id !== keep?.id).slice(0, Math.max(0, max - 1));
  return profiles.filter((p) => p.id === keep?.id || kept.includes(p));
}
