/**
 * Pure decisions behind the "AI mode" setting (see aiMode.ts). Kept free of Electron imports so
 * they can be unit-tested directly.
 */

import type { Profile } from '@talysman/shared';
import { policyHasJudgeRule } from '@talysman/product';

/**
 * The user's AI mode choice. An explicit stored choice always wins. With none stored yet, AI mode
 * starts off — unless a profile already has an active AI rule, so people who were using AI
 * filtering before this setting existed aren't silently switched to fallback verdicts.
 */
export function resolveAiModeEnabled(stored: boolean | undefined, profiles: readonly Profile[]): boolean {
  if (stored !== undefined) return stored;
  return profiles.some((profile) => policyHasJudgeRule(profile.policy));
}

/** What the daemon's `smartFilteringEnabled` capability flag should be: build flag AND user choice. */
export function effectiveSmartFiltering(buildEnabled: boolean, aiModeEnabled: boolean): boolean {
  return buildEnabled && aiModeEnabled;
}
