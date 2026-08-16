/**
 * THE SINGLE SOURCE OF TRUTH for the UI ⇄ service RPC contract (architecture §6).
 *
 * Wire format is newline-delimited JSON (NDJSON): each line is one `WireMessage`. There are
 * two kinds of message — request/response (RPC) and server-pushed events (see events.ts).
 * The Rust service mirrors these shapes; native/protocol/schema.json is the language-neutral
 * copy both sides conform to.
 */

import type { Policy } from './policy.js';
import type { Profile } from './profile.js';
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
  /** True when no stable identifier is available (presence falls back to a marker file). */
  serialAmbiguous: boolean;
}

/** A key that has been paired. Secrets/hashes never leave the service. */
export interface PairedKey {
  id: string;
  label: string;
  /** True if this key was paired using the marker-file fallback. */
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
  /** Every blocking profile the user has defined; never empty. */
  profiles: Profile[];
  /** Which profile focus enforces right now. */
  activeProfileId: string;
  /** Derived: the active profile's policy. This is what enforcement actually applies. */
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
  /**
   * Edit the **active** profile's policy. Kept as the flat shorthand the blocklist editor uses;
   * gated exactly like `setProfile` on the active profile.
   */
  setPolicy: { params: { policy: Policy }; result: Ok };
  /**
   * Create or replace one profile. Relaxing a profile's policy is key-gated — a profile that is
   * not active today may be switched in by a locked schedule window tomorrow, so pre-loosening
   * it must cost the same as loosening the live one.
   */
  setProfile: { params: { profile: Profile }; result: Ok };
  /**
   * Remove a profile. Key-gated when the profile is active or referenced by a schedule window;
   * may fail LAST_PROFILE when it is the only one left.
   */
  deleteProfile: { params: { profileId: string }; result: Ok };
  /**
   * Switch which profile focus enforces. Free while focus is off; key-gated while focus is
   * active (any switch can relax what is currently blocked) and refused during a locked window.
   */
  setActiveProfile: { params: { profileId: string }; result: Ok };
  setSchedule: { params: { schedule: Schedule }; result: Ok };
  /**
   * Toggle the browser handshake strict mode. Enabling is free; **disabling** is gated
   * exactly like `disableFocus` (the service re-checks USB presence) and may fail KEY_REQUIRED /
   * LOCKED.
   */
  setBrowserHandshake: { params: { enabled: boolean }; result: Ok };
  /**
   * Toggle the system tray icon. Purely cosmetic — never key-gated, unlike the other settings
   * above. The daemon-linked tray helper binaries (one per platform under native/) are the ones
   * that actually read this; it lives here (rather than a local Electron preference) because they
   * only ever talk to the daemon, never to Electron.
   */
  setTrayIconEnabled: { params: { enabled: boolean }; result: Ok };
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
  /** Requires at least one paired key; may fail NO_PAIRED_KEY. */
  enableFocus: { params: { reason?: string }; result: Ok };
  /** Service re-checks USB presence itself; may fail KEY_REQUIRED / LOCKED. */
  disableFocus: { params: Record<string, never>; result: Ok };
  listRemovableDrives: { params: void; result: { drives: Drive[] } };
  pairKey: { params: { driveId: string; label: string }; result: { key: PairedKey } };
  /** Removing a key is itself key-gated and may not remove the final paired key. */
  unpairKey: { params: { keyId: string }; result: Ok };
  getKeyPresence: { params: void; result: { present: boolean; keyId?: string } };
  ping: { params: void; result: { version: string; protocolVersion: number } };

  /**
   * Extension → (via natmsg) → service: a page under an `intent`-enabled profile fell through
   * both hard lists and needs judging. Fire-and-forget; the service broadcasts `judgeRequested`
   * for Electron to pick up and answers (or times out to `defaultAction`) via `judgeResult`.
   */
  judgeRequest: { params: { requestId: string; url: string; extractedText: string }; result: Ok };
  /**
   * Electron main → service: the verdict for a pending `judgeRequested`. Unknown/already-resolved
   * `requestId`s are ignored (the timeout sweep may have already answered fail-closed).
   */
  submitJudgeVerdict: {
    params: { requestId: string; url: string; relevant: boolean; reason: string };
    result: Ok;
  };

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
