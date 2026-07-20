/** Server-pushed event types (architecture §6). The service pushes these unsolicited. */

import type { Policy } from './policy.js';
import type { Settings } from './settings.js';
import type { FocusSource } from './protocol.js';

export interface EventMap {
  keyPresenceChanged: { present: boolean; keyId?: string };
  focusChanged: { active: boolean; source: FocusSource };
  policyChanged: { policy: Policy };
  scheduleFired: { windowId: string; active: boolean };
  settingsChanged: { settings: Settings };
  /**
   * The browser handshake watchdog is about to close a browser whose extension stopped responding
   * (or an unsupported browser open during a locked session). Surfaced to the user as a warning.
   */
  browserWatchdogWarning: { browser: string; pid: number };
  /**
   * The watchdog force-terminated a browser after its warning and graceful-close windows expired.
   * The desktop main process turns this into a native system notification with recovery steps.
   */
  browserWatchdogKilled: { browser: string; pid: number };
}

export type EventName = keyof EventMap;
export type EventPayload<E extends EventName> = EventMap[E];

export interface EventMessage<E extends EventName = EventName> {
  kind: 'event';
  event: E;
  payload: EventPayload<E>;
}
