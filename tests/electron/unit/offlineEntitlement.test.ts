import { entitlementForPlan } from '@talysman/product';
import { describe, expect, it } from 'vitest';
import {
  entitlementForOfflineUse,
  OFFLINE_ENTITLEMENT_GRACE_MS,
} from '../../../apps/desktop/src/main/auth/offlineEntitlement.js';

const verifiedAt = new Date('2026-07-01T12:00:00.000Z');
const cachedPro = entitlementForPlan('pro', 'server', {
  fetchedAt: verifiedAt.toISOString(),
  cacheUntil: '2026-07-01T12:05:00.000Z',
});

describe('offline entitlement verification lease', () => {
  it('keeps a verified premium entitlement for 30 days while offline', () => {
    const atDeadline = new Date(verifiedAt.getTime() + OFFLINE_ENTITLEMENT_GRACE_MS);

    expect(entitlementForOfflineUse(cachedPro, atDeadline)).toMatchObject({
      active: true,
      plan: 'pro',
      source: 'offline',
    });
  });

  it('requires verification again after 30 days', () => {
    const afterDeadline = new Date(verifiedAt.getTime() + OFFLINE_ENTITLEMENT_GRACE_MS + 1);

    expect(entitlementForOfflineUse(cachedPro, afterDeadline)).toBeUndefined();
  });

  it('does not trust legacy or malformed caches without a valid verification time', () => {
    const legacy = entitlementForPlan('pro', 'server');
    const malformed = { ...cachedPro, fetchedAt: 'not-a-date' };

    expect(entitlementForOfflineUse(legacy, verifiedAt)).toBeUndefined();
    expect(entitlementForOfflineUse(malformed, verifiedAt)).toBeUndefined();
  });

  it('does not trust a verification time more than five minutes in the future', () => {
    const future = {
      ...cachedPro,
      fetchedAt: new Date(verifiedAt.getTime() + 5 * 60 * 1000 + 1).toISOString(),
    };

    expect(entitlementForOfflineUse(future, verifiedAt)).toBeUndefined();
  });
});
