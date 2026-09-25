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

export type { PremadeListId, PremadeListMeta } from './premadeLists';
export { PREMADE_LISTS } from './premadeLists';

/** UI-preset label only — never part of the enforced/wire `Policy` shape. */
export type PolicyPreset = 'blacklist' | 'whitelist' | 'block-all' | 'smart';

/**
 * `Policy`, `AppRef`, `JudgePolicy` and `JudgeTask` are generated from the Rust engine
 * (native/engine/src/policy.rs → ./generated, `pnpm gen:types`): one definition for the daemons,
 * Android, and TypeScript.
 */
export type { AppRef, JudgePolicy, JudgeTask, Policy } from './generated/index.js';

import type { Policy } from './generated/index.js';

export const EMPTY_POLICY: Policy = {
  blockedDomains: [],
  allowedDomains: [],
  defaultAction: 'allow',
  judge: null,
  apps: [],
  enabledPremadeLists: [],
  sites: {},
};
