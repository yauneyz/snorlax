import { z } from 'zod';
import type { Policy, Profile, Schedule } from '@talysman/shared';
import { resolveActiveProfile, siteRuleUsesJudge } from '@talysman/shared';

export const SUBSCRIPTION_PLANS = ['free', 'pro'] as const;
export const CHECKOUT_PRICES = ['monthly', 'yearly', 'lifetime'] as const;
/** The two recurring cycles — excludes 'lifetime', which is a one-time payment, not a cycle. */
export const RECURRING_CHECKOUT_PRICES = ['monthly', 'yearly'] as const;
export const FREE_BLOCKED_SITE_LIMIT = 5;
/** Free keeps a single blocking profile; Pro is unlimited. */
export const FREE_PROFILE_LIMIT = 1;
export const ENTITLEMENT_GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
/** Pro-only per-user daily cap on LLM judge calls, enforced by the web `judge` route. */
export const SMART_FILTER_DAILY_JUDGE_LIMIT = 500;

export type ProductEnvironment = 'development' | 'production';

/**
 * Rollout flags shared by the desktop client and web backend. Keeping the decision here prevents
 * a production UI from hiding a feature while its server-side implementation remains callable.
 */
export function productFeaturesForEnvironment(environment: ProductEnvironment) {
  void environment;
  return {
    smartFiltering: true,
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
} as const satisfies Record<(typeof RECURRING_CHECKOUT_PRICES)[number], number>;

/**
 * The list price early-adopter pricing is discounted from — not a Stripe price, display only,
 * backs the "usually $10/mo, $100/year" copy.
 */
export const PRO_LIST_PRICE_CENTS = {
  monthly: 1000,
  yearly: 10000,
} as const satisfies Record<(typeof RECURRING_CHECKOUT_PRICES)[number], number>;

/** What a year on the annual plan saves against twelve monthly charges, in cents. */
export const PRO_ANNUAL_SAVINGS_CENTS = PRO_PRICE_CENTS.monthly * 12 - PRO_PRICE_CENTS.yearly;

/** The early-adopter discount off list price, as a whole percent — same function for both cycles. */
export function proDiscountPercent(cycle: (typeof RECURRING_CHECKOUT_PRICES)[number]): number {
  return Math.round(
    ((PRO_LIST_PRICE_CENTS[cycle] - PRO_PRICE_CENTS[cycle]) / PRO_LIST_PRICE_CENTS[cycle]) * 100,
  );
}

/** The annual plan's cost per week, in cents — backs the "less than $1/week" copy. */
export const PRO_ANNUAL_WEEKLY_CENTS = PRO_PRICE_CENTS.yearly / 52;

/** One-time price for permanent Pro access, in cents — no cycle, no renewal. */
export const LIFETIME_PRICE_CENTS = 14900;

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
  return policy.judge !== null
    || policy.defaultAction === 'judge'
    || Object.entries(policy.sites ?? {}).some(([id, rule]) => siteRuleUsesJudge(id, rule));
}

/**
 * Whether any rule actually sends pages to the AI judge — a judged default or a judged site
 * feature. Tasks alone are inert. TS mirror of the daemon's `Policy::uses_judge`.
 */
export function policyHasJudgeRule(policy: Policy): boolean {
  return policy.defaultAction === 'judge'
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
