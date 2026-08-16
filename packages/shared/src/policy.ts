/**
 * Policy data model (architecture §7). The *normalized* form (produced by
 * @core/policyNormalize) is what crosses the IPC boundary to the privileged service.
 *
 * There is no enforced "mode" anymore: `blockedDomains` and `allowedDomains` are independent
 * hard lists (never judged), `defaultAction` decides everything that hits neither list (and is
 * also the fail-closed/fail-open fallback when `intent` judging is unreachable), and `intent`
 * is an optional third layer that only evaluates domains falling through both hard lists.
 * Classic blacklist/whitelist/block-all are just presets over this shape — see
 * `apps/desktop/src/renderer/pages/Blocklists.tsx`.
 */

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

/**
 * What the user is working on, judged against pages that hit neither hard list. `positive` is
 * required for `intent` to be non-null; `negative` names things to still exclude even if
 * plausibly related.
 */
export interface PolicyIntent {
  positive: string;
  negative?: string;
}

export interface Policy {
  /** Hard block — DNR-enforced, always denied, never judged. e.g. ["youtube.com", "*.reddit.com"] */
  blockedDomains: string[];
  /** Hard allow — always permitted, never judged (and never sent for content extraction). */
  allowedDomains: string[];
  /** Fallback for domains on neither hard list; also the fallback when the judge is unreachable. */
  defaultAction: 'allow' | 'block';
  /** Non-null activates Smart filtering for domains on neither hard list. */
  intent: PolicyIntent | null;
  apps: AppRef[];
}

export const EMPTY_POLICY: Policy = {
  blockedDomains: [],
  allowedDomains: [],
  defaultAction: 'allow',
  intent: null,
  apps: [],
};
