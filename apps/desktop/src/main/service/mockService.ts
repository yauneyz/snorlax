/**
 * In-process fake service implementing the full protocol (architecture §16, category-1).
 * Used by `pnpm dev` (so the UI fully works without the native service / on WSL) and by the
 * e2e tests. It is the behavioural reference for the disable gate: it refuses `disableFocus`
 * unless a (simulated) key is present and no locked window is active.
 *
 * Dev affordance: `devToggleKey()` flips the simulated USB key so you can exercise the
 * red/green indicator and the key-required path without real hardware.
 */

import {
  DEFAULT_SETTINGS,
  EMPTY_POLICY,
  EMPTY_SCHEDULE,
  ErrorCode,
  PROTOCOL_VERSION,
  type Drive,
  type EventName,
  type EventPayload,
  type Method,
  type PairedKey,
  type Params,
  type Result,
  type ServiceState,
  OK,
} from '@talysman/shared';
import { evaluateSchedule, normalizePolicy } from '@talysman/core';
import type { ServiceConnection, ServiceError } from './connection.js';

function err(code: string, message: string): ServiceError {
  const e = new Error(message) as ServiceError;
  e.code = code;
  return e;
}

const MOCK_DRIVES: Drive[] = [
  { id: 'mock-drive-1', label: 'SanDisk Ultra (E:)', mountPoint: 'E:\\', serial: 'AA11BB22', serialAmbiguous: false },
  { id: 'mock-drive-2', label: 'Generic Flash (F:)', mountPoint: 'F:\\', serialAmbiguous: true },
];

type Listener = (payload: unknown) => void;

export class MockServiceConnection implements ServiceConnection {
  connected = true;

  private listeners = new Map<EventName, Set<Listener>>();
  private keyPresent = false;
  private presentKeyId: string | undefined;

  private state: ServiceState = {
    protocolVersion: PROTOCOL_VERSION,
    serviceVersion: '0.1.0-mock',
    focusActive: false,
    focusSource: 'boot',
    policy: { ...EMPTY_POLICY, domains: ['youtube.com', '*.reddit.com'] },
    schedule: EMPTY_SCHEDULE,
    settings: { ...DEFAULT_SETTINGS },
    pairedKeys: [],
    keyPresent: false,
    scheduleLocked: false,
  };

  async connect(): Promise<void> {
    /* already "connected" */
  }

  close(): void {
    this.listeners.clear();
  }

  on<E extends EventName>(event: E, cb: (payload: EventPayload<E>) => void): () => void {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(cb as Listener);
    this.listeners.set(event, set);
    return () => set.delete(cb as Listener);
  }

  private emit<E extends EventName>(event: E, payload: EventPayload<E>): void {
    this.listeners.get(event)?.forEach((cb) => cb(payload));
  }

  private snapshot(): ServiceState {
    const evalNow = evaluateSchedule(this.state.schedule, new Date());
    return {
      ...this.state,
      keyPresent: this.keyPresent,
      presentKeyId: this.presentKeyId,
      scheduleLocked: evalNow.active && evalNow.locked,
    };
  }

  /** Dev-only: simulate plugging/unplugging the paired key. */
  devToggleKey(): boolean {
    const firstKey = this.state.pairedKeys[0];
    this.keyPresent = !this.keyPresent;
    this.presentKeyId = this.keyPresent ? firstKey?.id : undefined;
    this.emit('keyPresenceChanged', { present: this.keyPresent, keyId: this.presentKeyId });
    return this.keyPresent;
  }

  async request<M extends Method>(method: M, params: Params<M>): Promise<Result<M>> {
    switch (method) {
      case 'getState':
        return this.snapshot();

      case 'ping':
        return { version: this.state.serviceVersion, protocolVersion: PROTOCOL_VERSION } as Result<M>;

      case 'getKeyPresence':
        return { present: this.keyPresent, keyId: this.presentKeyId } as Result<M>;

      case 'setPolicy': {
        const policy = (params as Params<'setPolicy'>).policy;
        this.state.policy = normalizePolicy(policy);
        this.emit('policyChanged', { policy: this.state.policy });
        return OK;
      }

      case 'setSchedule': {
        this.state.schedule = (params as Params<'setSchedule'>).schedule;
        return OK;
      }

      case 'enableFocus': {
        this.state.focusActive = true;
        this.state.focusSource = 'user';
        this.emit('focusChanged', { active: true, source: 'user' });
        return OK;
      }

      case 'disableFocus': {
        const snap = this.snapshot();
        if (snap.scheduleLocked) throw err(ErrorCode.LOCKED, 'A locked schedule window is active.');
        if (!this.keyPresent) throw err(ErrorCode.KEY_REQUIRED, 'Insert your paired key to unlock.');
        this.state.focusActive = false;
        this.state.focusSource = 'user';
        this.emit('focusChanged', { active: false, source: 'user' });
        return OK;
      }

      case 'setBrowserHandshake': {
        const enabled = (params as Params<'setBrowserHandshake'>).enabled;
        // Turning ON is free; turning OFF is key-gated exactly like disableFocus.
        if (!enabled) {
          const snap = this.snapshot();
          if (snap.scheduleLocked) throw err(ErrorCode.LOCKED, 'A locked schedule window is active.');
          if (!this.keyPresent) throw err(ErrorCode.KEY_REQUIRED, 'Insert your paired key to unlock.');
        }
        this.state.settings = { ...this.state.settings, browserHandshakeEnabled: enabled };
        this.emit('settingsChanged', { settings: this.state.settings });
        return OK;
      }

      case 'extHeartbeat':
        // The mock has no real browsers to watch; accept and ignore.
        return OK;

      case 'listRemovableDrives':
        return { drives: MOCK_DRIVES } as Result<M>;

      case 'pairKey': {
        const { driveId, label } = params as Params<'pairKey'>;
        const drive = MOCK_DRIVES.find((d) => d.id === driveId);
        const key: PairedKey = {
          id: `key-${this.state.pairedKeys.length + 1}`,
          label: label || drive?.label || 'Paired key',
          serialAmbiguous: drive?.serialAmbiguous ?? true,
          pairedAt: Date.now(),
        };
        this.state.pairedKeys = [...this.state.pairedKeys, key];
        return { key } as Result<M>;
      }

      case 'unpairKey': {
        if (!this.keyPresent) throw err(ErrorCode.KEY_REQUIRED, 'Insert your key to remove a key.');
        const { keyId } = params as Params<'unpairKey'>;
        this.state.pairedKeys = this.state.pairedKeys.filter((k) => k.id !== keyId);
        return OK;
      }

      case 'recover':
        // Mock accepts any non-empty code so dev/e2e can exercise the unlock path.
        if (!(params as Params<'recover'>).code) throw err(ErrorCode.BAD_RECOVERY_CODE, 'Empty code.');
        this.state.focusActive = false;
        this.state.focusSource = 'recover';
        this.emit('focusChanged', { active: false, source: 'recover' });
        return OK;

      default:
        throw err(ErrorCode.BAD_REQUEST, `Unknown method: ${String(method)}`);
    }
  }
}
