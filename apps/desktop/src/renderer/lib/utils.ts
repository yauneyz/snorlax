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
  const { blockedDomains, allowedDomains, defaultAction, intent, apps } = profile.policy;
  const hasSmartIntent = SMART_FILTERING_ENABLED && intent !== null;
  const isBlockAll =
    defaultAction === 'block' &&
    blockedDomains.length === 0 &&
    allowedDomains.length === 0 &&
    !hasSmartIntent;

  let sites: string;
  if (isBlockAll) {
    sites = 'blocks everything';
  } else if (hasSmartIntent) {
    sites = 'smart filtering';
  } else if (defaultAction === 'block') {
    sites = `${allowedDomains.length} allowed site${allowedDomains.length === 1 ? '' : 's'}`;
  } else {
    sites = `${blockedDomains.length} blocked site${blockedDomains.length === 1 ? '' : 's'}`;
  }

  return apps.length > 0 ? `${sites} · ${apps.length} app${apps.length === 1 ? '' : 's'}` : sites;
}
