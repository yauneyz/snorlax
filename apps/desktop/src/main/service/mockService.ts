/**
 * In-process fake service implementing the full protocol (architecture §16, category-1).
 * Used by `pnpm dev:mock` (so the UI works without the native service / on WSL) and by the e2e
 * tests. Every blocking decision — profiles, schedules, gating, overrides, pools, emergency
 * unlocks, the streak — runs in the real Rust engine compiled to wasm (`@talysman/engine-wasm`),
 * so the mock behaves exactly like the daemons. Only the USB key and the OS are simulated.
 *
 * Dev affordance: `devToggleKey()` flips the simulated USB key so you can exercise the
 * red/green indicator and the key-required path without real hardware.
 */

import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  DEFAULT_SETTINGS,
  EMPTY_POLICY,
  ErrorCode,
  PROFILE_COLORS,
  PROTOCOL_VERSION,
  emptyProfileConfig,
  type AppRef,
  type Auth,
  type Command,
  type Drive,
  type EventName,
  type EventPayload,
  type FocusSource,
  type Method,
  type PairedKey,
  type Params,
  type Policy,
  type Result,
  type ServiceState,
  type Settings,
  type Tick,
  type TransitionKind,
  type UsageTransition,
  OK,
} from '@talysman/shared';
import { ctxAt, Engine, EngineCallError } from '@talysman/engine-wasm';
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

function seedEngine(now: number): Engine {
  const engine = Engine.empty('mock-device');
  const config = emptyProfileConfig();
  engine.apply(
    {
      type: 'upsertProfile',
      profile: {
        id: DEFAULT_PROFILE_ID,
        name: DEFAULT_PROFILE_NAME,
        color: PROFILE_COLORS[0],
        config: { ...config, policy: { ...EMPTY_POLICY, blockedDomains: ['youtube.com', '*.reddit.com'] } },
      },
    },
    { kind: 'none' },
    ctxAt(now, false),
  );
  engine.apply({ type: 'setDefaultProfile', profileId: DEFAULT_PROFILE_ID }, { kind: 'none' }, ctxAt(now, false));
  return engine;
}

export class MockServiceConnection implements ServiceConnection {
  connected = true;

  private listeners = new Map<EventName, Set<Listener>>();
  private keyPresent = false;
  private presentKeyId: string | undefined;
  private usageLog: UsageTransition[] = [];
  private usageSeq = 0;
  private pairedKeys: PairedKey[] = [];
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private engine: Engine;
  private networkPolicy: Policy = EMPTY_POLICY;
  private active = false;
  private focusSource: FocusSource = 'boot';
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly clock: () => number = Date.now) {
    this.engine = seedEngine(clock());
    this.tick();
  }

  async connect(): Promise<void> {
    /* already "connected" */
  }

  close(): void {
    this.listeners.clear();
    if (this.timer) clearTimeout(this.timer);
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

  private ctx() {
    return ctxAt(this.clock(), this.pairedKeys.length > 0);
  }

  private snapshot(): ServiceState {
    const engine = this.engine.snapshot(this.ctx());
    return {
      protocolVersion: PROTOCOL_VERSION,
      serviceVersion: '0.1.0-mock',
      focusActive: this.active,
      focusSource: this.focusSource,
      policy: this.networkPolicy,
      engine,
      settings: this.settings,
      pairedKeys: this.pairedKeys,
      keyPresent: this.keyPresent,
      presentKeyId: this.presentKeyId,
      scheduleLocked: engine.profiles.some((p) => p.activation.active && p.activation.lockedUntilMs !== null),
    };
  }

  private recordTransition(kind: TransitionKind, source: FocusSource): void {
    this.usageSeq += 1;
    this.usageLog.push({ seq: this.usageSeq, at: this.clock(), kind, source });
  }

  /** Mirror of `Core::handle_tick`: push the effective policy and announce what changed. */
  private handleTick(tick: Tick): void {
    const policy = this.engine.networkPolicy(this.ctx());
    if (JSON.stringify(policy) !== JSON.stringify(this.networkPolicy)) {
      this.networkPolicy = policy;
      this.emit('policyChanged', { policy });
    }
    const active = tick.effective.layers.length > 0;
    if (active !== this.active) {
      const snapshot = this.engine.snapshot(this.ctx());
      this.focusSource = snapshot.profiles.some((p) => p.activation.active && p.activation.latched) ? 'user' : 'schedule';
      this.active = active;
      this.recordTransition(active ? 'focusOn' : 'focusOff', this.focusSource);
      this.emit('focusChanged', { active, source: this.focusSource });
    }
    for (const event of tick.events) {
      if (event.kind === 'scheduleFired') {
        this.recordTransition('scheduleFired', 'schedule');
        this.emit('scheduleFired', { profileId: event.profileId, action: event.action });
      }
    }
    this.scheduleWake(tick.nextWakeMs);
  }

  private scheduleWake(nextWakeMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    const delay = Math.min(Math.max(nextWakeMs - this.clock(), 0) + 50, 60 * 60 * 1000);
    this.timer = setTimeout(() => this.tick(), delay);
    // Never keep a test process alive just for the schedule timer.
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** Advance the engine clock (schedule edges, pool expiry, timed overrides). */
  tick(): void {
    const tick = this.engine.tick(this.ctx());
    this.handleTick(tick);
    if (tick.events.length > 0) this.emit('stateChanged', { state: this.snapshot() });
  }

  /** Run a command, "verifying" the simulated key if the engine asks for it. */
  private run(command: Command): void {
    const ctx = this.ctx();
    const gate = this.engine.gate(command, ctx);
    let auth: Auth = { kind: 'none' };
    if (gate.kind === 'needsKey') {
      if (!this.keyPresent || !this.presentKeyId) {
        throw err(ErrorCode.KEY_REQUIRED, 'Insert your paired key to do this.');
      }
      auth = { kind: 'keyVerified', keyId: this.presentKeyId };
    }
    try {
      this.handleTick(this.engine.apply(command, auth, ctx).tick);
    } catch (e) {
      if (e instanceof EngineCallError) throw err(e.code, e.message);
      throw e;
    }
    this.emit('stateChanged', { state: this.snapshot() });
  }

  private defaultProfileId(): string | undefined {
    const state = this.engine.export();
    return state.defaultProfileId ?? state.profiles[0]?.id;
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
    const firstKey = this.pairedKeys[0];
    this.keyPresent = Boolean(firstKey) && !this.keyPresent;
    this.presentKeyId = this.keyPresent ? firstKey?.id : undefined;
    this.emit('keyPresenceChanged', { present: this.keyPresent, keyId: this.presentKeyId });
    return this.keyPresent;
  }

  /** Dev-only: pretend the service just closed a blocked app, to exercise the unlock popup. */
  devSimulateAppBlocked(app: AppRef): void {
    this.emit('appBlocked', { app });
  }

  /**
   * Dev-only: push one fake exact-usage transition (architecture §7/Phase 7), so `pnpm dev:mock`
   * can drive `drainUsage` without a real Rust service.
   */
  devPushUsageTransition(kind: TransitionKind, source: FocusSource = 'user'): UsageTransition {
    this.recordTransition(kind, source);
    return this.usageLog[this.usageLog.length - 1]!;
  }

  async request<M extends Method>(method: M, params: Params<M>): Promise<Result<M>> {
    switch (method) {
      case 'getState':
        return this.snapshot();

      case 'ping':
        return { version: '0.1.0-mock', protocolVersion: PROTOCOL_VERSION } as Result<M>;

      case 'getKeyPresence':
        return { present: this.keyPresent, keyId: this.presentKeyId } as Result<M>;

      case 'applyCommand': {
        const { command, dryRun } = params as Params<'applyCommand'>;
        if (dryRun) return { gate: this.engine.gate(command, this.ctx()) } as Result<M>;
        this.run(command);
        return OK;
      }

      case 'getPopupInfo': {
        const { target } = params as Params<'getPopupInfo'>;
        return this.engine.popupInfo(target, this.ctx());
      }

      case 'enableFocus': {
        if (this.active) return OK;
        if (this.pairedKeys.length === 0) {
          throw err(ErrorCode.NO_PAIRED_KEY, 'Pair a key before turning on focus.');
        }
        const profileId = this.defaultProfileId();
        if (!profileId) throw err(ErrorCode.BAD_REQUEST, 'No profile to turn on.');
        this.run({ type: 'setLatch', profileId, on: true });
        return OK;
      }

      case 'disableFocus': {
        if (this.active) this.run({ type: 'startOverrideAll' });
        return OK;
      }

      case 'toggleFocus': {
        await this.request(this.active ? 'disableFocus' : 'enableFocus', {});
        return { ...OK, active: this.active } as Result<M>;
      }

      case 'setBrowserHandshake': {
        const enabled = (params as Params<'setBrowserHandshake'>).enabled;
        // Turning ON is free; turning OFF needs the key and no locked window.
        if (!enabled) {
          if (this.snapshot().scheduleLocked) throw err(ErrorCode.LOCKED, 'A locked schedule window is active.');
          if (!this.keyPresent) throw err(ErrorCode.KEY_REQUIRED, 'Insert your paired key to unlock.');
        }
        this.settings = { ...this.settings, browserHandshakeEnabled: enabled };
        this.emit('settingsChanged', { settings: this.settings });
        return OK;
      }

      case 'setTrayIconEnabled': {
        // Purely cosmetic — never gated, unlike the settings above.
        const enabled = (params as Params<'setTrayIconEnabled'>).enabled;
        this.settings = { ...this.settings, trayIconEnabled: enabled };
        this.emit('settingsChanged', { settings: this.settings });
        return OK;
      }

      case 'setSmartFilteringEnabled': {
        const enabled = (params as Params<'setSmartFilteringEnabled'>).enabled;
        this.settings = { ...this.settings, smartFilteringEnabled: enabled };
        this.emit('settingsChanged', { settings: this.settings });
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
        return {
          heartbeat: {
            sequence: beat.sequence ?? 0,
            browserPid: beat.browserPid,
            healthy: beat.health.canBlock && beat.health.permissionsOk,
          },
        } as Result<M>;
      }

      case 'drainUsage': {
        const { afterSeq } = params as Params<'drainUsage'>;
        const transitions = this.usageLog.filter((t) => t.seq > afterSeq);
        return { transitions, latestSeq: this.usageSeq } as Result<M>;
      }

      case 'listRemovableDrives':
        return { drives: MOCK_DRIVES } as Result<M>;

      case 'pairKey': {
        const { driveId, label } = params as Params<'pairKey'>;
        const gate = this.engine.gate({ type: 'pairKey' }, this.ctx());
        if (gate.kind === 'needsKey' && !this.keyPresent) {
          throw err(ErrorCode.KEY_REQUIRED, 'Insert a key you already paired to pair another while blocking is on.');
        }
        const drive = MOCK_DRIVES.find((d) => d.id === driveId);
        const key: PairedKey = {
          id: `key-${this.pairedKeys.length + 1}`,
          label: label || drive?.label || 'Paired key',
          serialAmbiguous: drive?.serialAmbiguous ?? true,
          pairedAt: this.clock(),
        };
        const auth: Auth = gate.kind === 'needsKey' ? { kind: 'keyVerified', keyId: this.presentKeyId ?? key.id } : { kind: 'none' };
        this.pairedKeys = [...this.pairedKeys, key];
        this.engine.apply({ type: 'pairKey' }, auth, this.ctx());
        this.emit('stateChanged', { state: this.snapshot() });
        return { key } as Result<M>;
      }

      case 'unpairKey': {
        const { keyId } = params as Params<'unpairKey'>;
        if (!this.pairedKeys.some((key) => key.id === keyId)) {
          throw err(ErrorCode.BAD_REQUEST, 'Paired key not found.');
        }
        if (this.pairedKeys.length === 1) {
          throw err(ErrorCode.LAST_PAIRED_KEY, 'Pair another key before removing your last key.');
        }
        if (!this.keyPresent) throw err(ErrorCode.KEY_REQUIRED, 'Insert your key to remove a key.');
        this.engine.apply({ type: 'unpairKey' }, { kind: 'keyVerified', keyId: this.presentKeyId ?? keyId }, this.ctx());
        this.pairedKeys = this.pairedKeys.filter((k) => k.id !== keyId);
        if (this.presentKeyId === keyId) {
          this.keyPresent = false;
          this.presentKeyId = undefined;
          this.emit('keyPresenceChanged', { present: false });
        }
        this.emit('stateChanged', { state: this.snapshot() });
        return OK;
      }

      case 'judgeRequest':
      case 'submitJudgeVerdict':
        return OK;

      default:
        throw err(ErrorCode.BAD_REQUEST, `Unknown method: ${String(method)}`);
    }
  }
}
