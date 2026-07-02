/**
 * THE SINGLE SOURCE OF TRUTH for the UI ⇄ service RPC contract (architecture §6).
 *
 * Wire format is newline-delimited JSON (NDJSON): each line is one `WireMessage`. There are
 * two kinds of message — request/response (RPC) and server-pushed events (see events.ts).
 * The Rust service mirrors these shapes; native/protocol/schema.json is the language-neutral
 * copy both sides conform to.
 */

import type { Policy } from './policy.js';
import type { Schedule } from './schedule.js';
import type { Settings, BrowserHealth } from './settings.js';
import type { ErrorCode } from './constants.js';

// ---------------------------------------------------------------------------
// Domain value types
// ---------------------------------------------------------------------------

/** A removable drive as surfaced for the pairing picker. */
export interface Drive {
  /** Opaque, stable-ish id for this drive (device instance path or volume guid). */
  id: string;
  /** Human label, e.g. "SanDisk Ultra (E:)". */
  label: string;
  /** Mount point / drive letter on Windows, e.g. "E:\\". */
  mountPoint?: string;
  /** USB device serial, if the device reports one. */
  serial?: string;
  /** True when no unique serial is available (presence falls back to the key file). */
  serialAmbiguous: boolean;
}

/** A key that has been paired. Secrets/hashes never leave the service. */
export interface PairedKey {
  id: string;
  label: string;
  /** True if this key was paired without a reliable hardware serial. */
  serialAmbiguous: boolean;
  pairedAt: number; // epoch ms
}

/** Why focus changed, for UI messaging. */
export type FocusSource = 'user' | 'schedule' | 'boot' | 'recover';

/** Full authoritative snapshot returned by `getState` and broadcast on changes. */
export interface ServiceState {
  protocolVersion: number;
  serviceVersion: string;
  focusActive: boolean;
  focusSource: FocusSource;
  policy: Policy;
  schedule: Schedule;
  settings: Settings;
  pairedKeys: PairedKey[];
  keyPresent: boolean;
  presentKeyId?: string;
  /** True when a `locked` schedule window is currently active (disable is blocked). */
  scheduleLocked: boolean;
}

// ---------------------------------------------------------------------------
// Requests (UI → service)
// ---------------------------------------------------------------------------

export interface RequestMap {
  getState: { params: void; result: ServiceState };
  setPolicy: { params: { policy: Policy }; result: Ok };
  setSchedule: { params: { schedule: Schedule }; result: Ok };
  /**
   * Toggle the browser handshake dead-man's switch. Enabling is free; **disabling** is gated
   * exactly like `disableFocus` (the service re-checks USB presence) and may fail KEY_REQUIRED /
   * LOCKED.
   */
  setBrowserHandshake: { params: { enabled: boolean }; result: Ok };
  /**
   * Liveness heartbeat from the browser extension, relayed by the native-messaging host
   * (talysman-natmsg). Fire-and-forget; the service records it for the watchdog. `browserPid` is
   * the host's parent process — the browser instance the extension runs in.
   */
  extHeartbeat: {
    params: {
      browserPid: number;
      browser: string;
      profileId?: string;
      extensionVersion?: string;
      lockedActive?: boolean;
      health: BrowserHealth;
    };
    result: Ok;
  };
  enableFocus: { params: { reason?: string }; result: Ok };
  /** Service re-checks USB presence itself; may fail KEY_REQUIRED / LOCKED. */
  disableFocus: { params: Record<string, never>; result: Ok };
  listRemovableDrives: { params: void; result: { drives: Drive[] } };
  pairKey: { params: { driveId: string; label: string }; result: { key: PairedKey } };
  /** Removing a key is itself key-gated. */
  unpairKey: { params: { keyId: string }; result: Ok };
  getKeyPresence: { params: void; result: { present: boolean; keyId?: string } };
  ping: { params: void; result: { version: string; protocolVersion: number } };

  /**
   * Privileged out-of-band killswitch. NOT surfaced in the UI — invoked by
   * talysman-recover.exe. Bypasses the USB and `locked` gates iff `code` matches the
   * recovery code stored at install time.
   */
  recover: { params: { code: string }; result: Ok };
}

export type Method = keyof RequestMap;
export type Params<M extends Method> = RequestMap[M]['params'];
export type Result<M extends Method> = RequestMap[M]['result'];

export interface Ok {
  ok: true;
}
export const OK: Ok = { ok: true };

// ---------------------------------------------------------------------------
// Wire envelopes
// ---------------------------------------------------------------------------

export interface RpcRequest<M extends Method = Method> {
  kind: 'request';
  id: number;
  method: M;
  params: Params<M>;
}

export interface RpcResponseOk<M extends Method = Method> {
  kind: 'response';
  id: number;
  ok: true;
  result: Result<M>;
}

export interface RpcResponseErr {
  kind: 'response';
  id: number;
  ok: false;
  code: ErrorCode;
  message: string;
}

export type RpcResponse<M extends Method = Method> = RpcResponseOk<M> | RpcResponseErr;

// Re-exported here so consumers can import the event envelope from one module.
export type { EventMessage } from './events.js';

import type { EventMessage } from './events.js';
export type WireMessage = RpcRequest | RpcResponse | EventMessage;
