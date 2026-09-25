/**
 * Blocking profiles (spec §3.1). A profile is a named, coloured bundle of all blocking config:
 * web/app rules and soft rules (`config.policy`), pools, schedule rules, and one-shot events.
 * Any number can be active at once; enforcement is the union (most restrictive wins).
 *
 * The data types are generated from the Rust engine (`./generated`); this module keeps the
 * UI-side helpers (palette, defaults, names).
 */

import type { Profile, ProfileConfig, ProfileInput } from './generated/index.js';
import { EMPTY_POLICY } from './policy.js';
import { PROFILE_COLORS } from './palette.js';

export type {
  Activation,
  Latch,
  LatchSource,
  Profile,
  ProfileConfig,
  ProfileInput,
  ProfileStatus,
  BlockMode,
} from './generated/index.js';

export { PROFILE_COLORS } from './palette.js';

export const DEFAULT_PROFILE_ID = 'profile-default';
export const DEFAULT_PROFILE_NAME = 'Default';

/** Max length accepted for a profile name; longer names are rejected as BAD_REQUEST. */
export const MAX_PROFILE_NAME_LENGTH = 40;

export function emptyProfileConfig(): ProfileConfig {
  return { policy: EMPTY_POLICY, appMode: 'blacklist', allowedApps: [], pools: [], schedule: [], oneShots: [] };
}

/** The editable part of a profile, as `upsertProfile` takes it. */
export function profileInput(profile: Pick<Profile, 'id' | 'name' | 'color' | 'config'>): ProfileInput {
  return { id: profile.id, name: profile.name, color: profile.color, config: profile.config };
}

/** A fresh, unique profile id. */
export function newProfileId(): string {
  return `profile-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** The next unused colour in the palette, cycling once every colour is taken. */
export function nextProfileColor(profiles: readonly { color: string }[]): string {
  const used = new Set(profiles.map((p) => p.color));
  return PROFILE_COLORS.find((c) => !used.has(c)) ?? PROFILE_COLORS[profiles.length % PROFILE_COLORS.length]!;
}
