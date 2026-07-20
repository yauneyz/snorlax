import type { Entitlement } from '@talysman/product';

/** Maximum time a server-verified entitlement may be trusted without connectivity. */
export const OFFLINE_ENTITLEMENT_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

// Allow ordinary clock drift, but do not let a bad/future timestamp extend the lease.
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Convert a previously verified server entitlement into an offline entitlement while its
 * 30-day verification lease is still current. Server responses always carry `fetchedAt`;
 * caches without a valid timestamp are deliberately not trusted for premium access.
 */
export function entitlementForOfflineUse(
  cached: Entitlement,
  now: Date = new Date(),
): Entitlement | undefined {
  if (!cached.fetchedAt) return undefined;

  const verifiedAt = Date.parse(cached.fetchedAt);
  const nowMs = now.getTime();
  if (!Number.isFinite(verifiedAt) || !Number.isFinite(nowMs)) return undefined;

  const ageMs = nowMs - verifiedAt;
  if (ageMs < -CLOCK_SKEW_MS || ageMs > OFFLINE_ENTITLEMENT_GRACE_MS) return undefined;

  return { ...cached, source: 'offline' };
}
