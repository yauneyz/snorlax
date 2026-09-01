/**
 * Session replay for the desktop renderer. Scoped to the Talysman app window only — this is a
 * single-window Electron UI, not a browsing surface, so there is no page navigation concept and
 * no risk of recording content outside the app.
 *
 * Never initializes for `pnpm dev`/`dev:desktop` (isDev) or `pnpm release:local` (isLocalRelease,
 * the developer's own daily-driver install) — both stay silent regardless of a configured key.
 * Identifies by the desktop's opaque `device_id` only; no email/PII (architecture §3.15).
 */

import posthog from 'posthog-js';

export interface SessionReplayConfig {
  posthogKey: string;
  posthogHost: string;
  isDev: boolean;
  isLocalRelease: boolean;
  deviceId: string;
}

let initialized = false;

export function initSessionReplay(config: SessionReplayConfig): void {
  if (initialized) return;
  if (config.isDev || config.isLocalRelease || !config.posthogKey) return;

  posthog.init(config.posthogKey, {
    api_host: config.posthogHost,
    autocapture: false,
    capture_pageview: false,
    person_profiles: 'identified_only',
    session_recording: { maskAllInputs: true },
  });
  posthog.identify(config.deviceId);
  initialized = true;
}
