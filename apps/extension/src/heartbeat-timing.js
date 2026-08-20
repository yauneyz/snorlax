export const STRICT_HEARTBEAT_MS = 5000;
export const ACTIVE_HEARTBEAT_MS = 30000;
export const IDLE_HEARTBEAT_MS = 60000;

/**
 * Pick the heartbeat cadence without letting an incomplete state snapshot weaken enforcement.
 * A missing handshake flag is treated as enabled while focus is active; only an explicit `false`
 * may select the slower active cadence.
 */
export function heartbeatDelayForState({ browser, blockingActive, handshakeEnabled }) {
  if (blockingActive && handshakeEnabled !== false) return STRICT_HEARTBEAT_MS;
  return blockingActive ? ACTIVE_HEARTBEAT_MS : IDLE_HEARTBEAT_MS;
}
