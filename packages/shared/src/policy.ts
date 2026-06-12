/**
 * Policy data model (architecture §7). The *normalized* form (produced by
 * @core/policyNormalize) is what crosses the IPC boundary to the privileged service.
 */

export type Mode = 'blacklist' | 'whitelist' | 'block-all';

/** Platform-neutral app identity; populate the field relevant to the target OS. */
export interface AppRef {
  /** e.g. "chrome.exe" — matched on Windows. */
  windowsImageName?: string;
  /** e.g. "com.google.Chrome" — matched on macOS. */
  macBundleId?: string;
  /** User-facing name. */
  label: string;
}

export interface Policy {
  mode: Mode;
  /** e.g. ["youtube.com", "*.reddit.com"] */
  domains: string[];
  apps: AppRef[];
}

export const EMPTY_POLICY: Policy = {
  mode: 'blacklist',
  domains: [],
  apps: [],
};
