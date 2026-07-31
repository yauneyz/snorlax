import {
  ENTITLEMENT_GRACE_PERIOD_MS,
  isWithinEntitlementGracePeriod,
  type Entitlement,
} from '@talysman/product';

/** @deprecated Import ENTITLEMENT_GRACE_PERIOD_MS from @talysman/product instead. */
export const OFFLINE_ENTITLEMENT_GRACE_MS = ENTITLEMENT_GRACE_PERIOD_MS;

/**
 * Convert a previously verified server entitlement into an offline entitlement while its
 * 30-day verification lease is still current. Server responses always carry `fetchedAt`;
 * caches without a valid timestamp are deliberately not trusted for premium access.
 */
export function entitlementForOfflineUse(
  cached: Entitlement,
  now: Date = new Date(),
): Entitlement | undefined {
  if (!isWithinEntitlementGracePeriod(cached.fetchedAt, now)) return undefined;

  return { ...cached, source: 'offline' };
}
