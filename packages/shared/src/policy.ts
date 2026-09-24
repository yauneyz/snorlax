/**
 * Policy data model (architecture §7 and "Blocking model"). The *normalized* form (produced by
 * @core/policyNormalize) is what crosses the IPC boundary to the privileged service.
 *
 * Every layer yields a `RuleAction` — allow, judge, or block — evaluated in this order:
 *   1. `blockedDomains` — hard block, never judged.
 *   2. `sites` — per-site feature rules from the site catalog (`./sites`), e.g. Reddit posts
 *      allowed while its feeds are blocked. Features may also be `judge`d.
 *   3. `allowedDomains` — hard allow, never judged.
 *   4. `enabledPremadeLists` — built-in category blocklists.
 *   5. `defaultAction` — everything else: allowed, blocked, or judged.
 * `judge` hands the page to the AI judge, which weighs it against `judge.tasks` and `judge.avoid`
 * and falls back to `judge.fallback` when it can't answer. Classic blacklist/whitelist/block-all/
 * smart are presets over this shape — see `apps/desktop/src/renderer/pages/Blocklists.tsx`.
 */

import type { PremadeListId } from './premadeLists';
import type { RuleAction, SiteRule } from './sites/types';

export type { PremadeListId, PremadeListMeta } from './premadeLists';
export { PREMADE_LISTS } from './premadeLists';

/** UI-preset label only — never part of the enforced/wire `Policy` shape. */
export type PolicyPreset = 'blacklist' | 'whitelist' | 'block-all' | 'smart';

/** Platform-neutral app identity; populate the field relevant to the target OS. */
export interface AppRef {
  /** e.g. "chrome.exe" — matched on Windows. */
  windowsImageName?: string;
  /** e.g. "chrome" or "firefox" — matched on Linux. */
  linuxProcessName?: string;
  /** e.g. "com.google.Chrome" — matched on macOS. */
  macBundleId?: string;
  /** User-facing name. */
  label: string;
}

/** Something the user is working on; the AI judge allows pages that help with any task. */
export interface JudgeTask {
  id: string;
  title: string;
  notes?: string;
}

/** Configuration for the AI judge that resolves every `judge` action. */
export interface JudgePolicy {
  tasks: JudgeTask[];
  /** Things to block even when plausibly related to a task ("help me avoid"). */
  avoid: string[];
  /** What a `judge` action becomes when the judge can't answer (offline, over budget, unentitled). */
  fallback: 'allow' | 'block';
}

export interface Policy {
  /** Hard block — DNR-enforced, always denied, never judged. e.g. ["youtube.com", "*.reddit.com"] */
  blockedDomains: string[];
  /** Hard allow — always permitted, never judged (and never sent for content extraction). */
  allowedDomains: string[];
  /** Action for pages no other layer decides. */
  defaultAction: RuleAction;
  /** AI judge configuration; required for any `judge` action to be judged (otherwise they allow). */
  judge: JudgePolicy | null;
  apps: AppRef[];
  /** Built-in bulk blocklist categories the user has toggled on (e.g. "nsfw", "shopping"). */
  enabledPremadeLists: PremadeListId[];
  /** Site-catalog rules keyed by site id. A present key enables the site's rules. */
  sites: Record<string, SiteRule>;
}

export const EMPTY_POLICY: Policy = {
  blockedDomains: [],
  allowedDomains: [],
  defaultAction: 'allow',
  judge: null,
  apps: [],
  enabledPremadeLists: [],
  sites: {},
};
