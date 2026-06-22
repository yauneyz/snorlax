import { z } from 'zod';
import type { Mode, Policy, Schedule } from '@focuslock/shared';

export const SUBSCRIPTION_PLANS = ['free', 'pro'] as const;
export const CHECKOUT_PRICES = ['monthly', 'yearly'] as const;

export const subscriptionPlanSchema = z.enum(SUBSCRIPTION_PLANS);
export const checkoutPriceSchema = z.enum(CHECKOUT_PRICES);

export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>;
export type CheckoutPrice = z.infer<typeof checkoutPriceSchema>;

export const entitlementSourceSchema = z.enum([
  'stub',
  'dev-override',
  'server',
  'cache',
  'offline',
]);

export type EntitlementSource = z.infer<typeof entitlementSourceSchema>;

export const entitlementSchema = z.object({
  active: z.boolean(),
  plan: subscriptionPlanSchema,
  source: entitlementSourceSchema,
  status: z.string().optional(),
  currentPeriodEnd: z.string().optional(),
  fetchedAt: z.string().optional(),
  cacheUntil: z.string().optional(),
});

export type Entitlement = z.infer<typeof entitlementSchema>;

type LimitedValue = number | null;

export interface ProductLimits {
  policy?: {
    modes?: readonly Mode[];
    maxDomains?: LimitedValue;
    maxApps?: LimitedValue;
  };
  schedule?: {
    enabled?: boolean;
  };
}

export interface LimitViolation {
  field: 'policy.mode' | 'policy.domains' | 'policy.apps' | 'schedule';
  message: string;
}

const FREE_LIMITS: ProductLimits = {
  policy: {
    modes: ['blacklist', 'block-all'],
    maxDomains: 5,
    maxApps: 0,
  },
  schedule: {
    enabled: false,
  },
};

export function entitlementForPlan(
  plan: SubscriptionPlan,
  source: EntitlementSource,
  metadata: Omit<Partial<Entitlement>, 'active' | 'plan' | 'source'> = {},
): Entitlement {
  return { active: plan === 'pro', plan, source, ...metadata };
}

export function limitsForPlan(plan: SubscriptionPlan): ProductLimits | null {
  return plan === 'free' ? FREE_LIMITS : null;
}

export function isScheduleEnabled(limits: ProductLimits | null): boolean {
  return limits?.schedule?.enabled !== false;
}

export function allowedPolicyModes(limits: ProductLimits | null): readonly Mode[] | null {
  return limits?.policy?.modes ?? null;
}

export function maxPolicyDomains(limits: ProductLimits | null): LimitedValue {
  return limits?.policy?.maxDomains ?? null;
}

export function maxPolicyApps(limits: ProductLimits | null): LimitedValue {
  return limits?.policy?.maxApps ?? null;
}

export function validatePolicyForLimits(
  policy: Policy,
  limits: ProductLimits | null,
): LimitViolation[] {
  if (!limits?.policy) return [];

  const violations: LimitViolation[] = [];
  const modes = allowedPolicyModes(limits);
  const maxDomains = maxPolicyDomains(limits);
  const maxApps = maxPolicyApps(limits);

  if (modes && !modes.includes(policy.mode)) {
    violations.push({
      field: 'policy.mode',
      message: 'Free supports blacklist and block-all modes only.',
    });
  }

  if (maxDomains !== null && policy.domains.length > maxDomains) {
    violations.push({
      field: 'policy.domains',
      message: `Free supports up to ${maxDomains} blocked websites.`,
    });
  }

  if (maxApps !== null && policy.apps.length > maxApps) {
    violations.push({
      field: 'policy.apps',
      message: 'Free does not include app blocking.',
    });
  }

  return violations;
}

export function validateScheduleForLimits(
  schedule: Schedule,
  limits: ProductLimits | null,
): LimitViolation[] {
  if (isScheduleEnabled(limits) || schedule.windows.length === 0) return [];
  return [{ field: 'schedule', message: 'Free does not include scheduling.' }];
}

export function constrainPolicyToLimits(policy: Policy, limits: ProductLimits | null): Policy {
  if (!limits?.policy) return policy;

  const modes = allowedPolicyModes(limits);
  const maxDomains = maxPolicyDomains(limits);
  const maxApps = maxPolicyApps(limits);

  return {
    mode: modes?.includes(policy.mode) ? policy.mode : modes?.[0] ?? policy.mode,
    domains: maxDomains === null ? policy.domains : policy.domains.slice(0, maxDomains),
    apps: maxApps === null ? policy.apps : policy.apps.slice(0, maxApps),
  };
}

export function constrainScheduleToLimits(
  schedule: Schedule,
  limits: ProductLimits | null,
): Schedule {
  return isScheduleEnabled(limits) ? schedule : { windows: [] };
}
