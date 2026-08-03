/**
 * In-process fake service implementing the full protocol (architecture §16, category-1).
 * Used by `pnpm dev:mock` (so the UI works without the native service / on WSL) and by the e2e
 * tests. It is the behavioural reference for the focus gates: focus requires a paired key
 * to enable, and disabling requires a (simulated) key to be present with no locked window.
 *
 * Dev affordance: `devToggleKey()` flips the simulated USB key so you can exercise the
 * red/green indicator and the key-required path without real hardware.
 */

import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  DEFAULT_SETTINGS,
  EMPTY_POLICY,
  EMPTY_SCHEDULE,
  ErrorCode,
  MAX_PROFILE_NAME_LENGTH,
  PROFILE_COLORS,
  PROTOCOL_VERSION,
  activePolicy,
  upsertProfile,
  type Drive,
  type EventName,
  type EventPayload,
  type Method,
  type PairedKey,
  type Params,
  type Profile,
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
    profiles: [
      {
        id: DEFAULT_PROFILE_ID,
        name: DEFAULT_PROFILE_NAME,
        color: PROFILE_COLORS[0],
        policy: { ...EMPTY_POLICY, domains: ['youtube.com', '*.reddit.com'] },
      },
    ],
    activeProfileId: DEFAULT_PROFILE_ID,
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
      policy: activePolicy(this.state.profiles, this.state.activeProfileId),
      keyPresent: this.keyPresent,
      presentKeyId: this.presentKeyId,
      scheduleLocked: evalNow.active && evalNow.locked,
    };
  }

  /**
   * Write a new profile set / active profile and announce it. `policy` is derived here so the
   * flat snapshot field and the profiles can never disagree.
   */
  private commitProfiles(profiles: Profile[], activeProfileId = this.state.activeProfileId): void {
    const policy = activePolicy(profiles, activeProfileId);
    const policyChanged = JSON.stringify(policy) !== JSON.stringify(this.state.policy);
    this.state = { ...this.state, profiles, activeProfileId, policy };
    this.emit('profilesChanged', { profiles, activeProfileId });
    if (policyChanged) this.emit('policyChanged', { policy });
  }

  /** Drop the `rejected` diagnostics so what we store is a plain Policy. */
  private clean(policy: Parameters<typeof normalizePolicy>[0]) {
    const { rejected: _rejected, ...clean } = normalizePolicy(policy);
    return clean;
  }

  /**
   * Dev-only: fake one browser-extension heartbeat. The real native-messaging host can't reach
   * the in-process mock, so this is the only way to exercise the extension handshake UI under
   * `pnpm dev:mock`.
   */
  devSimulateExtensionHeartbeat(): void {
    this.emit('extensionHeartbeat', {
      browser: 'Chrome',
      pid: 4242,
      extensionVersion: '0.1.0-mock',
      healthy: true,
    });
  }

  /** Dev-only: simulate plugging/unplugging the paired key. */
  devToggleKey(): boolean {
    const firstKey = this.state.pairedKeys[0];
    this.keyPresent = Boolean(firstKey) && !this.keyPresent;
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
        // The flat shorthand: edit whichever profile is active.
        const policy = (params as Params<'setPolicy'>).policy;
        const active = this.state.profiles.find((p) => p.id === this.state.activeProfileId);
        if (!active) throw err(ErrorCode.INTERNAL, 'No active profile.');
        this.commitProfiles(
          upsertProfile(this.state.profiles, { ...active, policy: this.clean(policy) }),
        );
        return OK;
      }

      case 'setProfile': {
        const { profile } = params as Params<'setProfile'>;
        const name = profile.name.trim();
        if (!profile.id.trim()) throw err(ErrorCode.BAD_REQUEST, 'Profile id cannot be empty.');
        if (!name) throw err(ErrorCode.BAD_REQUEST, 'Profile name cannot be empty.');
        if (name.length > MAX_PROFILE_NAME_LENGTH) {
          throw err(
            ErrorCode.BAD_REQUEST,
            `Profile names are limited to ${MAX_PROFILE_NAME_LENGTH} characters.`,
          );
        }
        this.commitProfiles(
          upsertProfile(this.state.profiles, { ...profile, name, policy: this.clean(profile.policy) }),
        );
        return OK;
      }

      case 'deleteProfile': {
        const { profileId } = params as Params<'deleteProfile'>;
        if (!this.state.profiles.some((p) => p.id === profileId)) {
          throw err(ErrorCode.BAD_REQUEST, 'Profile not found.');
        }
        if (this.state.profiles.length === 1) {
          throw err(ErrorCode.LAST_PROFILE, 'Keep at least one blocking profile.');
        }
        const isActive = this.state.activeProfileId === profileId;
        const scheduled = this.state.schedule.windows.some((w) => w.profileId === profileId);
        if (isActive || scheduled) {
          if (this.snapshot().scheduleLocked) {
            throw err(ErrorCode.LOCKED, 'A locked schedule window is active.');
          }
          if (!this.keyPresent) {
            throw err(ErrorCode.KEY_REQUIRED, 'Insert your paired key to delete this profile.');
          }
        }
        const profiles = this.state.profiles.filter((p) => p.id !== profileId);
        // Orphaned windows fall back to whatever profile is active when they fire.
        this.state.schedule = {
          windows: this.state.schedule.windows.map((w) =>
            w.profileId === profileId ? { ...w, profileId: undefined } : w,
          ),
        };
        this.commitProfiles(profiles, isActive ? profiles[0]!.id : this.state.activeProfileId);
        return OK;
      }

      case 'setActiveProfile': {
        const { profileId } = params as Params<'setActiveProfile'>;
        if (!this.state.profiles.some((p) => p.id === profileId)) {
          throw err(ErrorCode.BAD_REQUEST, 'Profile not found.');
        }
        if (profileId === this.state.activeProfileId) return OK;
        if (this.snapshot().scheduleLocked) {
          throw err(ErrorCode.LOCKED, 'A locked schedule window is active.');
        }
        // Switching while the shield is up can loosen what is blocked, so it costs the key.
        if (this.state.focusActive && !this.keyPresent) {
          throw err(ErrorCode.KEY_REQUIRED, 'Insert your paired key to switch profiles.');
        }
        this.commitProfiles(this.state.profiles, profileId);
        return OK;
      }

      case 'setSchedule': {
        const { schedule } = params as Params<'setSchedule'>;
        for (const w of schedule.windows) {
          if (w.profileId && !this.state.profiles.some((p) => p.id === w.profileId)) {
            throw err(ErrorCode.BAD_REQUEST, `Unknown blocking profile: ${w.profileId}`);
          }
        }
        this.state.schedule = schedule;
        return OK;
      }

      case 'enableFocus': {
        if (this.state.pairedKeys.length === 0) {
          throw err(ErrorCode.NO_PAIRED_KEY, 'Pair a key before turning on focus.');
        }
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

      case 'extHeartbeat': {
        // The mock has no real browsers to watch, but it still announces the beat so the UI's
        // "extension is talking to us" signal behaves the same as against the real service.
        const beat = params as Params<'extHeartbeat'>;
        this.emit('extensionHeartbeat', {
          browser: beat.browser,
          pid: beat.browserPid,
          extensionVersion: beat.extensionVersion,
          healthy: beat.health.canBlock && beat.health.permissionsOk,
        });
        return OK;
      }

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
        const { keyId } = params as Params<'unpairKey'>;
        if (!this.state.pairedKeys.some((key) => key.id === keyId)) {
          throw err(ErrorCode.BAD_REQUEST, 'Paired key not found.');
        }
        if (this.state.pairedKeys.length === 1) {
          throw err(ErrorCode.LAST_PAIRED_KEY, 'Pair another key before removing your last key.');
        }
        if (!this.keyPresent) throw err(ErrorCode.KEY_REQUIRED, 'Insert your key to remove a key.');
        this.state.pairedKeys = this.state.pairedKeys.filter((k) => k.id !== keyId);
        if (this.presentKeyId === keyId) {
          this.keyPresent = false;
          this.presentKeyId = undefined;
          this.emit('keyPresenceChanged', { present: false });
        }
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
