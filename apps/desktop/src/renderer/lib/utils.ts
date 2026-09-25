import type { Policy, Profile, RuleAction } from '@talysman/shared';
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

/**
 * What a rule action actually does given AI mode. With AI mode off, `judge` is enforced as the
 * judge's fallback (mirrors natmsg `Blocking::resolve`), so that's what the UI shows too.
 */
export function effectiveAction(action: RuleAction, policy: Policy, aiMode: boolean): RuleAction {
  if (action !== 'judge' || aiMode) return action;
  return policy.judge?.fallback ?? 'allow';
}

/** One-line description of what a profile blocks — used on the seal and in the profile rail. */
export function profileSummary(profile: Profile, aiMode: boolean): string {
  const policy = profile.config.policy;
  const { blockedDomains, allowedDomains, apps } = policy;
  const defaultAction = effectiveAction(policy.defaultAction, policy, aiMode);
  const softCount = Object.keys(policy.sites ?? {}).length;
  const hasSmartIntent = defaultAction === 'judge';
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
