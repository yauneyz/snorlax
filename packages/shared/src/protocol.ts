/**
 * THE SINGLE SOURCE OF TRUTH for the UI ⇄ service RPC contract (architecture §6).
 *
 * Wire format is newline-delimited JSON (NDJSON): each line is one `WireMessage`. There are
 * two kinds of message — request/response (RPC) and server-pushed events (see events.ts).
 * The Rust service mirrors these shapes; native/protocol/schema.json is the language-neutral
 * copy both sides conform to.
 */

import type { Policy } from './policy.js';
import type { Settings, BrowserHealth } from './settings.js';
import type { Command, EngineSnapshot, Gate, JournalEntry, PopupInfo, PopupTarget } from './generated/index.js';
import type { ErrorCode } from './constants.js';
import type { JudgePage, JudgeVerdict } from './judge.js';

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
export type FocusSource = 'user' | 'schedule' | 'boot';

/** One entry in the exact-usage transition log the service maintains (architecture §7/Phase 7). */
export type TransitionKind = 'focusOn' | 'focusOff' | 'scheduleFired' | 'keyPresent' | 'keyAbsent';

/** A single recorded focus/presence/schedule transition, for `drainUsage`. */
export interface UsageTransition {
  /** Monotonically increasing per device; used as the drain cursor. */
  seq: number;
  /** Epoch ms. */
  at: number;
  kind: TransitionKind;
  source: FocusSource;
}

/**
 * Full authoritative snapshot returned by `getState` and broadcast on changes (protocol 6).
 * `focusActive`/`policy` keep their v5 meaning for the native-messaging hosts, tray, and CLIs:
 * whether anything is enforced, and the one flat policy enforcement applies (every active
 * profile merged, most restrictive wins). Profiles, schedules, overrides, pools, the streak and
 * emergency unlocks are all in `engine`.
 */
export interface ServiceState {
  protocolVersion: number;
  serviceVersion: string;
  focusActive: boolean;
  focusSource: FocusSource;
  policy: Policy;
  engine: EngineSnapshot;
  settings: Settings;
  pairedKeys: PairedKey[];
  keyPresent: boolean;
  presentKeyId?: string;
  /** Some active profile is held by a locked schedule window. */
  scheduleLocked: boolean;
}

// ---------------------------------------------------------------------------
// Requests (UI → service)
// ---------------------------------------------------------------------------

export interface RequestMap {
  getState: { params: void; result: ServiceState };
  /**
   * Run one engine command (spec §4.3): profile edits, turning profiles on/off, pool unlocks,
   * overrides, emergency unlocks. The service asks for the USB key itself when the engine's gate
   * says so (KEY_REQUIRED / LOCKED otherwise). With `dryRun` nothing changes and the gate is
   * returned instead, so the UI can show the key prompt (and what's being loosened) up front.
   */
  applyCommand: {
    params: { command: Command; dryRun?: boolean };
    result: { gate?: Gate; ok?: true; journal?: JournalEntry[] };
  };
  /** What the block/unlock popup shows for a URL or app. */
  getPopupInfo: { params: { target: PopupTarget }; result: PopupInfo };
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
   * Desktop build capability; false resolves every `judge` action to `JudgePolicy.fallback`
   * without changing the policy contract.
   */
  setSmartFilteringEnabled: { params: { enabled: boolean }; result: Ok };
  /**
   * Liveness heartbeat from the browser extension, relayed by the native-messaging host
   * (talysman-natmsg). Fire-and-forget; the service records it for the watchdog. `browserPid` is
   * the host's parent process — the browser instance the extension runs in.
   */
  extHeartbeat: {
    params: {
      browserPid: number;
      browser: string;
      workerSessionId?: string;
      sequence?: number;
      sentAt?: number;
      extensionVersion?: string;
      /** Site-rule protocol generation of the extension build (diagnostic). */
      siteCapability?: number;
      lockedActive?: boolean;
      health: BrowserHealth;
    };
    result: { heartbeat: { sequence: number; browserPid: number; healthy: boolean } };
  };
  /** Tray/CLI shorthand: turn the default profile on. May fail NO_PAIRED_KEY. */
  enableFocus: { params: { reason?: string }; result: Ok };
  /** Tray/CLI shorthand: override (1), everything off until re-enabled. KEY_REQUIRED / LOCKED. */
  disableFocus: { params: Record<string, never>; result: Ok };
  toggleFocus: { params: Record<string, never>; result: Ok & { active: boolean } };
  listRemovableDrives: { params: void; result: { drives: Drive[] } };
  /** Free with nothing active; otherwise an already-paired key must be present (KEY_REQUIRED). */
  pairKey: { params: { driveId: string; label: string }; result: { key: PairedKey } };
  /** Removing a key is itself key-gated and may not remove the final paired key. */
  unpairKey: { params: { keyId: string }; result: Ok };
  getKeyPresence: { params: void; result: { present: boolean; keyId?: string } };
  ping: { params: void; result: { version: string; protocolVersion: number } };

  /**
   * Drain the exact-usage transition log newer than `afterSeq` (architecture §7/Phase 7).
   * Introduced additively in protocol 3. Protocol 4 keeps the same drain contract.
   */
  drainUsage: {
    params: { afterSeq: number };
    result: { transitions: UsageTransition[]; latestSeq: number };
  };

  /**
   * Extension → (via natmsg) → service: a rule resolved to `judge` for this page. Fire-and-forget;
   * the service attaches the active `JudgePolicy`, broadcasts `judgeRequested` for Electron to
   * pick up, and answers (or times out to `JudgePolicy.fallback`) via `judgeResult`.
   */
  judgeRequest: { params: JudgePage & { requestId: string }; result: Ok };
  /**
   * Electron main → service: the verdict for a pending `judgeRequested`. Unknown/already-resolved
   * `requestId`s are ignored (the timeout sweep may have already answered with the fallback).
   */
  submitJudgeVerdict: {
    params: { requestId: string; verdict: JudgeVerdict; reason: string };
    result: Ok;
  };

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
