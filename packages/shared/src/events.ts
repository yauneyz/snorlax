/** Server-pushed event types (architecture §6). The service pushes these unsolicited. */

import type { Policy } from './policy.js';
import type { Profile } from './profile.js';
import type { Settings } from './settings.js';
import type { FocusSource, ServiceState } from './protocol.js';

export interface EventMap {
  /** Complete authoritative snapshot after any persisted daemon state mutation. */
  stateChanged: { state: ServiceState };
  keyPresenceChanged: { present: boolean; keyId?: string };
  focusChanged: { active: boolean; source: FocusSource };
  /** The enforced (active profile's) policy changed, for whatever reason. */
  policyChanged: { policy: Policy };
  /** The profile set or the active profile changed. */
  profilesChanged: { profiles: Profile[]; activeProfileId: string };
  scheduleFired: { windowId: string; active: boolean };
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
}

export type EventName = keyof EventMap;
export type EventPayload<E extends EventName> = EventMap[E];

export interface EventMessage<E extends EventName = EventName> {
  kind: 'event';
  event: E;
  payload: EventPayload<E>;
}
