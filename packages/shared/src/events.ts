/** Server-pushed event types (architecture §6). The service pushes these unsolicited. */

import type { AppRef, Policy } from './policy.js';
import type { OnOff } from './schedule.js';
import type { Settings } from './settings.js';
import type { FocusSource, ServiceState } from './protocol.js';
import type { JudgePolicy } from './policy.js';
import type { JudgePage, JudgeVerdict } from './judge.js';

export interface EventMap {
  /** Complete authoritative snapshot after any persisted daemon state mutation. */
  stateChanged: { state: ServiceState };
  keyPresenceChanged: { present: boolean; keyId?: string };
  focusChanged: { active: boolean; source: FocusSource };
  /** The enforced (merged, flat) policy changed, for whatever reason. */
  policyChanged: { policy: Policy };
  /** An "on at"/"off at" rule or one-shot event flipped a profile. */
  scheduleFired: { profileId: string; action: OnOff };
  /**
   * The service closed a blocked desktop app. Electron fetches `getPopupInfo` for it and shows
   * the unlock popup (streak, pools, other options).
   */
  appBlocked: { app: AppRef };
  settingsChanged: { settings: Settings };
  /**
   * The browser handshake watchdog is about to close a browser whose extension stopped responding
   * (or an unsupported browser open during a locked session). Surfaced to the user as a warning.
   */
  browserWatchdogWarning: { browser: string; pid: number };
  /**
   * The watchdog force-terminated a browser after its graceful-close window expired.
   * The desktop main process turns this into a native system notification with recovery steps.
   */
  browserWatchdogKilled: { browser: string; pid: number };
  /**
   * A liveness heartbeat arrived from a browser extension (see `extHeartbeat`). Emitted on first
   * contact, health transitions, and at a throttled cadence so UI clients can confirm the install
   * without receiving every watchdog beat.
   */
  extensionHeartbeat: {
    browser: string;
    pid: number;
    extensionVersion?: string;
    /** The extension reports it holds the permissions **and** applied rules needed to block. */
    healthy: boolean;
  };
  /**
   * A rule resolved to `judge` for a page and it needs an AI verdict. Broadcast so Electron main
   * (the only client with entitlement/auth) can call the judge endpoint and answer with
   * `submitJudgeVerdict`. Carries the judge policy captured when the request arrived.
   */
  judgeRequested: JudgePage & { requestId: string; judge: JudgePolicy };
  /**
   * The verdict for a `judgeRequested` request — either from Electron's `submitJudgeVerdict` or
   * synthesized by the daemon (timeout sweep, AI filtering off) from `JudgePolicy.fallback`.
   * Relayed by natmsg back to the extension.
   */
  judgeResult: { requestId: string; url: string; verdict: JudgeVerdict; reason: string };
}

export type EventName = keyof EventMap;
export type EventPayload<E extends EventName> = EventMap[E];

export interface EventMessage<E extends EventName = EventName> {
  kind: 'event';
  event: E;
  payload: EventPayload<E>;
}
