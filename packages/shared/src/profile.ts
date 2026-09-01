/**
 * Blocking profiles (architecture §7). A profile is a named policy: the user keeps several
 * ("Deep Work", "Evening", …) and exactly one of them is *active* at any moment. Focus enforces
 * the active profile's policy, and schedule windows can switch the active profile automatically.
 *
 * `ServiceState.policy` remains the derived, currently-enforced policy so enforcement, the
 * browser extension, and the `policyChanged` event keep a single flat view of "what is blocked
 * right now".
 */

import type { Policy } from './policy.js';
import { EMPTY_POLICY } from './policy.js';
import { PROFILE_COLORS } from './palette.js';

export interface Profile {
  id: string;
  /** User-facing name, e.g. "Deep Work". */
  name: string;
  /** Accent colour (hex) used to identify the profile across the UI. */
  color: string;
  policy: Policy;
}

export { PROFILE_COLORS } from './palette.js';

export const DEFAULT_PROFILE_ID = 'profile-default';
export const DEFAULT_PROFILE_NAME = 'Default';

/** Max length accepted for a profile name; longer names are rejected as BAD_REQUEST. */
export const MAX_PROFILE_NAME_LENGTH = 40;

export const DEFAULT_PROFILE: Profile = {
  id: DEFAULT_PROFILE_ID,
  name: DEFAULT_PROFILE_NAME,
  color: PROFILE_COLORS[0],
  policy: EMPTY_POLICY,
};

/**
 * The profile `activeProfileId` points at. Falls back to the first profile so a dangling id
 * (e.g. after a delete raced a snapshot) never leaves the UI or the service without a policy.
 */
export function resolveActiveProfile(
  profiles: readonly Profile[],
  activeProfileId: string | undefined,
): Profile | undefined {
  return profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
}

/** The policy currently being enforced, i.e. the active profile's. */
export function activePolicy(
  profiles: readonly Profile[],
  activeProfileId: string | undefined,
): Policy {
  return resolveActiveProfile(profiles, activeProfileId)?.policy ?? EMPTY_POLICY;
}

/** Replace-or-append `profile` in `profiles`, preserving order. */
export function upsertProfile(profiles: readonly Profile[], profile: Profile): Profile[] {
  const idx = profiles.findIndex((p) => p.id === profile.id);
  if (idx === -1) return [...profiles, profile];
  const next = [...profiles];
  next[idx] = profile;
  return next;
}

/** The next unused colour in the palette, cycling once every colour is taken. */
export function nextProfileColor(profiles: readonly Profile[]): string {
  const used = new Set(profiles.map((p) => p.color));
  return PROFILE_COLORS.find((c) => !used.has(c)) ?? PROFILE_COLORS[profiles.length % PROFILE_COLORS.length]!;
}
