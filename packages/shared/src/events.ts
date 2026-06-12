/** Server-pushed event types (architecture §6). The service pushes these unsolicited. */

import type { Policy } from './policy.js';
import type { FocusSource } from './protocol.js';

export interface EventMap {
  keyPresenceChanged: { present: boolean; keyId?: string };
  focusChanged: { active: boolean; source: FocusSource };
  policyChanged: { policy: Policy };
  scheduleFired: { windowId: string; active: boolean };
}

export type EventName = keyof EventMap;
export type EventPayload<E extends EventName> = EventMap[E];

export interface EventMessage<E extends EventName = EventName> {
  kind: 'event';
  event: E;
  payload: EventPayload<E>;
}
