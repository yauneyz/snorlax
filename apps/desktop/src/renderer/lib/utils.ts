import type { Profile } from '@talysman/shared';
import { productFeaturesForEnvironment } from '@talysman/product';

const SMART_FILTERING_ENABLED = productFeaturesForEnvironment(
  __APP_CONFIG__.APP_ENV,
).smartFiltering;

/** Tiny classnames joiner (avoids pulling in clsx for a handful of components). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** One-line description of what a profile blocks — used on the seal and in the profile rail. */
export function profileSummary(profile: Profile): string {
  const { blockedDomains, allowedDomains, defaultAction, apps } = profile.policy;
  const softCount = Object.keys(profile.policy.sites ?? {}).length;
  const hasSmartIntent = SMART_FILTERING_ENABLED && defaultAction === 'judge';
  const isBlockAll =
    SMART_FILTERING_ENABLED &&
    defaultAction === 'block' &&
    blockedDomains.length === 0 &&
    allowedDomains.length === 0 &&
    softCount === 0 &&
    !hasSmartIntent;

  let sites: string;
  if (isBlockAll) {
    sites = 'blocks everything';
  } else if (hasSmartIntent) {
    sites = 'AI filter';
  } else if (defaultAction === 'block') {
    sites = `${allowedDomains.length} allowed site${allowedDomains.length === 1 ? '' : 's'}`;
  } else {
    sites = `${blockedDomains.length} blocked site${blockedDomains.length === 1 ? '' : 's'}`;
  }

  if (softCount > 0) {
    const softLabel = `${softCount} site rule${softCount === 1 ? '' : 's'}`;
    const onlySoftSites = defaultAction === 'block'
      ? allowedDomains.length === 0
      : blockedDomains.length === 0;
    sites = onlySoftSites ? softLabel : `${sites} · ${softLabel}`;
  }

  return apps.length > 0 ? `${sites} · ${apps.length} app${apps.length === 1 ? '' : 's'}` : sites;
}
