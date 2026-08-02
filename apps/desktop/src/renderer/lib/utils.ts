import type { Profile } from '@talysman/shared';

/** Tiny classnames joiner (avoids pulling in clsx for a handful of components). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** One-line description of what a profile blocks — used on the seal and in the profile rail. */
export function profileSummary(profile: Profile): string {
  const { mode, domains, apps } = profile.policy;
  if (mode === 'block-all') return 'blocks everything';
  const noun = mode === 'whitelist' ? 'allowed' : 'blocked';
  const sites = `${domains.length} ${noun} site${domains.length === 1 ? '' : 's'}`;
  return apps.length > 0 ? `${sites} · ${apps.length} app${apps.length === 1 ? '' : 's'}` : sites;
}
