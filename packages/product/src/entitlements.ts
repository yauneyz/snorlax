import { z } from 'zod';
import { checkoutPriceSchema } from './pricing.js';

export const SUBSCRIPTION_PLANS = ['free', 'pro'] as const;
export const ENTITLEMENT_GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Computers one Pro account can use at once. Generous for one person's laptop, desktop and work
 * machine; it exists to stop an account becoming a shared license, not to meter real use.
 * Free is unlimited and never counted.
 */
export const PRO_DEVICE_LIMIT = 5;
/** A computer that hasn't checked in for this long stops holding one of the Pro slots. */
export const PRO_DEVICE_STALE_AFTER_DAYS = 30;
/**
 * `Entitlement.status` when the account has Pro but this computer is over
 * {@link PRO_DEVICE_LIMIT}: the response is Free, and the app explains why.
 */
export const DEVICE_LIMIT_STATUS = 'device_limit';
/** Request headers the desktop app identifies its computer with on entitlement checks. */
export const DEVICE_HEADERS = {
  id: 'x-talysman-device-id',
  name: 'x-talysman-device-name',
  platform: 'x-talysman-platform',
} as const;

export const subscriptionPlanSchema = z.enum(SUBSCRIPTION_PLANS);
export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>;

export const entitlementSourceSchema = z.enum([
  'stub',
  'dev-override',
  'local-license',
  'server',
  'cache',
  'offline',
  // Sideloaded Talysman for Android: Pro without an account.
  'sideload',
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
