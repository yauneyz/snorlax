import { z } from 'zod';
import type { Policy, Profile, Schedule } from '@talysman/shared';
import { resolveActiveProfile } from '@talysman/shared';

export const SUBSCRIPTION_PLANS = ['free', 'pro'] as const;
export const CHECKOUT_PRICES = ['monthly', 'yearly'] as const;
export const FREE_BLOCKED_SITE_LIMIT = 5;
/** Free keeps a single blocking profile; Pro is unlimited. */
export const FREE_PROFILE_LIMIT = 1;
export const ENTITLEMENT_GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
/** Pro-only per-user daily cap on LLM judge calls, enforced by the web `judge-intent` route. */
export const SMART_FILTER_DAILY_JUDGE_LIMIT = 500;

export type ProductEnvironment = 'development' | 'production';

/**
 * Rollout flags shared by the desktop client and web backend. Keeping the decision here prevents
 * a production UI from hiding a feature while its server-side implementation remains callable.
 */
export function productFeaturesForEnvironment(environment: ProductEnvironment) {
  void environment;
  return {
    // Temporarily disabled in all environments, including development.
    smartFiltering: false,
  } as const;
}

/**
 * Length of the full-featured Pro trial started at Checkout. Stripe is the authority
 * once a subscription exists (`trial_end` is synced onto the row); this constant is
 * what we *ask* Stripe for, and what the marketing copy must quote.
 */
export const PRO_TRIAL_DAYS = 14;

/**
 * List prices in cents, mirroring the Stripe prices named by STRIPE_PRICE_MONTHLY /
 * STRIPE_PRICE_YEARLY. Kept here so the pricing page can do the annual math instead of
 * hardcoding "$8.33" in copy that silently rots when a price changes. Stripe remains the
 * source of truth for what is actually charged — these only drive display.
 *
 * This is early-adopter pricing: 50% off the eventual list price in {@link PRO_LIST_PRICE_CENTS}.
 */
export const PRO_PRICE_CENTS = {
  monthly: 499,
  yearly: 4999,
} as const satisfies Record<CheckoutPrice, number>;

/**
 * The list price early-adopter pricing is discounted from — not a Stripe price, display only,
 * backs the "usually $10/mo, $100/year" copy.
 */
export const PRO_LIST_PRICE_CENTS = {
  monthly: 1000,
  yearly: 10000,
} as const satisfies Record<CheckoutPrice, number>;

/** What a year on the annual plan saves against twelve monthly charges, in cents. */
export const PRO_ANNUAL_SAVINGS_CENTS = PRO_PRICE_CENTS.monthly * 12 - PRO_PRICE_CENTS.yearly;

/** The early-adopter discount off list price, as a whole percent — same function for both cycles. */
export function proDiscountPercent(cycle: CheckoutPrice): number {
  return Math.round(
    ((PRO_LIST_PRICE_CENTS[cycle] - PRO_PRICE_CENTS[cycle]) / PRO_LIST_PRICE_CENTS[cycle]) * 100,
  );
}

/** The annual plan's cost per week, in cents — backs the "less than $1/week" copy. */
export const PRO_ANNUAL_WEEKLY_CENTS = PRO_PRICE_CENTS.yearly / 52;

/**
 * Cents as a display price: `$10`, `$8.33`. Fractional cents round *down* so an
 * advertised "per month" figure can never overstate what twelve of them cost.
 */
export function formatPriceUsd(cents: number): string {
  const whole = Math.floor(cents / 100);
  const remainder = Math.floor(cents % 100);
  return remainder === 0 ? `$${whole}` : `$${whole}.${String(remainder).padStart(2, '0')}`;
}

export const subscriptionPlanSchema = z.enum(SUBSCRIPTION_PLANS);
export const checkoutPriceSchema = z.enum(CHECKOUT_PRICES);

export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>;
export type CheckoutPrice = z.infer<typeof checkoutPriceSchema>;

export const entitlementSourceSchema = z.enum([
  'stub',
  'dev-override',
  'local-license',
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

/**
 * Display-only snapshot of the user's current subscription. Separate from
 * `entitlementSchema` on purpose: entitlements are disk-cached and mirrored by
 * the signed local-license verifier, so their shape must stay frozen.
 */
export const subscriptionDetailSchema = z.object({
  hasSubscription: z.boolean(),
  plan: subscriptionPlanSchema,
  status: z.string().optional(),
  price: checkoutPriceSchema.optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
  currentPeriodEnd: z.string().optional(),
  canceledAt: z.string().nullable().optional(),
});

export type SubscriptionDetail = z.infer<typeof subscriptionDetailSchema>;

type LimitedValue = number | null;

export interface ProductLimits {
  policy?: {
    maxBlockedDomains?: LimitedValue;
    maxAllowedDomains?: LimitedValue;
    maxApps?: LimitedValue;
    /** Smart filtering (`Policy.intent`) has real per-page LLM cost — Pro-only. */
    smartFilteringEnabled?: boolean;
  };
  profiles?: {
    max?: LimitedValue;
  };
  schedule?: {
    enabled?: boolean;
  };
}

export interface LimitViolation {
  field: 'policy.blockedDomains' | 'policy.allowedDomains' | 'policy.intent' | 'policy.apps' | 'profiles' | 'schedule';
  message: string;
}

const FREE_LIMITS: ProductLimits = {
  policy: {
    // Only the block list was ever rate-limited on Free; the allow list (old "whitelist" mode)
    // has always been unlimited there — carried forward unchanged.
    maxBlockedDomains: FREE_BLOCKED_SITE_LIMIT,
    maxApps: 0,
    smartFilteringEnabled: false,
  },
  profiles: {
    max: FREE_PROFILE_LIMIT,
  },
  schedule: {
    enabled: false,
  },
};

// Allow ordinary clock drift, but do not let a bad/future timestamp extend a lease.
const ENTITLEMENT_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Whether a prior verification may still be trusted under the product's grace policy.
 * Desktop offline access and web billing uncertainty both use this policy.
 */
export function isWithinEntitlementGracePeriod(
  verifiedAt: string | undefined,
  now: Date = new Date(),
): boolean {
  if (!verifiedAt) return false;

  const verifiedAtMs = Date.parse(verifiedAt);
  const nowMs = now.getTime();
  if (!Number.isFinite(verifiedAtMs) || !Number.isFinite(nowMs)) return false;

  const ageMs = nowMs - verifiedAtMs;
  return ageMs >= -ENTITLEMENT_CLOCK_SKEW_MS && ageMs <= ENTITLEMENT_GRACE_PERIOD_MS;
}

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

export function smartFilteringAllowed(limits: ProductLimits | null): boolean {
  return limits?.policy?.smartFilteringEnabled !== false;
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

export function validatePolicyForLimits(
  policy: Policy,
  limits: ProductLimits | null,
): LimitViolation[] {
  if (!limits?.policy) return [];

  const violations: LimitViolation[] = [];
  const maxBlocked = maxBlockedDomains(limits);
  const maxAllowed = maxAllowedDomains(limits);
  const maxApps = maxPolicyApps(limits);

  if (maxBlocked !== null && policy.blockedDomains.length > maxBlocked) {
    violations.push({
      field: 'policy.blockedDomains',
      message: `Free supports up to ${maxBlocked} always-blocked websites.`,
    });
  }

  if (maxAllowed !== null && policy.allowedDomains.length > maxAllowed) {
    violations.push({
      field: 'policy.allowedDomains',
      message: `Free supports up to ${maxAllowed} always-allowed websites.`,
    });
  }

  if (policy.intent && !smartFilteringAllowed(limits)) {
    violations.push({
      field: 'policy.intent',
      message: 'Smart filtering is a Pro feature.',
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

export function validateProfilesForLimits(
  profiles: readonly Profile[],
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

export function validateScheduleForLimits(
  schedule: Schedule,
  limits: ProductLimits | null,
): LimitViolation[] {
  if (isScheduleEnabled(limits) || schedule.windows.length === 0) return [];
  return [{ field: 'schedule', message: 'Free does not include scheduling.' }];
}

export function constrainPolicyToLimits(policy: Policy, limits: ProductLimits | null): Policy {
  if (!limits?.policy) return policy;

  const maxBlocked = maxBlockedDomains(limits);
  const maxAllowed = maxAllowedDomains(limits);
  const maxApps = maxPolicyApps(limits);

  return {
    ...policy,
    blockedDomains:
      maxBlocked === null ? policy.blockedDomains : policy.blockedDomains.slice(0, maxBlocked),
    allowedDomains:
      maxAllowed === null ? policy.allowedDomains : policy.allowedDomains.slice(0, maxAllowed),
    intent: smartFilteringAllowed(limits) ? policy.intent : null,
    apps: maxApps === null ? policy.apps : policy.apps.slice(0, maxApps),
  };
}

/**
 * Trim the profile set to the plan's allowance. The *active* profile is always the one kept —
 * a downgrade must never silently swap out what is being enforced right now. The returned
 * profiles are otherwise order-stable.
 */
export function constrainProfilesToLimits(
  profiles: readonly Profile[],
  activeProfileId: string,
  limits: ProductLimits | null,
): Profile[] {
  const max = maxProfiles(limits);
  if (max === null || profiles.length <= max) return profiles as Profile[];
  if (max <= 0) return profiles.slice(0, 1);

  const active = resolveActiveProfile(profiles, activeProfileId);
  const kept = profiles.filter((p) => p.id !== active?.id).slice(0, Math.max(0, max - 1));
  return profiles.filter((p) => p.id === active?.id || kept.includes(p));
}

export function constrainScheduleToLimits(
  schedule: Schedule,
  limits: ProductLimits | null,
): Schedule {
  return isScheduleEnabled(limits) ? schedule : { windows: [] };
}
