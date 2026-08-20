import { describe, expect, it } from 'vitest';
import {
  ACTIVE_HEARTBEAT_MS,
  heartbeatDelayForState,
  IDLE_HEARTBEAT_MS,
  STRICT_HEARTBEAT_MS,
} from '../../../apps/extension/src/heartbeat-timing.js';

describe('extension heartbeat timing', () => {
  it('stays inside the watchdog TTL when focus is active and handshake state is missing', () => {
    for (const handshakeEnabled of [undefined, null, true]) {
      expect(
        heartbeatDelayForState({
          browser: 'chrome',
          blockingActive: true,
          handshakeEnabled,
        }),
      ).toBe(STRICT_HEARTBEAT_MS);
    }
  });

  it('uses the slower active cadence only when the handshake is explicitly disabled', () => {
    expect(
      heartbeatDelayForState({
        browser: 'chrome',
        blockingActive: true,
        handshakeEnabled: false,
      }),
    ).toBe(ACTIVE_HEARTBEAT_MS);
  });

  it('uses the idle cadence while focus is inactive', () => {
    expect(
      heartbeatDelayForState({
        browser: 'chrome',
        blockingActive: false,
        handshakeEnabled: true,
      }),
    ).toBe(IDLE_HEARTBEAT_MS);
  });

});
