/**
 * Constants shared by the Electron main process and the native service. The pipe name in
 * particular is mirrored on the Rust side (native/windows/src/ipc.rs) — keep them in sync.
 */

/** Protocol version negotiated on connect; bump on breaking RPC changes. */
export const PROTOCOL_VERSION = 1;

/** Deep-link scheme used for the billing return (Phase 3) and tray re-focus. */
export const DEEP_LINK_SCHEME = 'focuslock';

/**
 * Resolve the full Windows named-pipe path from the base name in config.
 * Dev uses a distinct pipe so a dev service and an installed service don't collide.
 */
export function windowsPipePath(baseName: string): string {
  return `\\\\.\\pipe\\${baseName}`;
}

/** Default base names (overridable via FOCUSLOCK_PIPE in env). */
export const PIPE_BASE_PROD = 'focuslock';
export const PIPE_BASE_DEV = 'focuslock-dev';

/** Standard error codes returned by the service across the IPC boundary. */
export const ErrorCode = {
  /** Disable refused: no paired USB key physically present right now. */
  KEY_REQUIRED: 'KEY_REQUIRED',
  /** Disable refused: a `locked` schedule window is currently active. */
  LOCKED: 'LOCKED',
  /** Recovery code did not match. */
  BAD_RECOVERY_CODE: 'BAD_RECOVERY_CODE',
  /** Generic bad request / validation failure. */
  BAD_REQUEST: 'BAD_REQUEST',
  /** Service-internal failure. */
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
