/**
 * The Rust engine (native/engine) compiled to wasm, with typed JSON in and out. The desktop mock
 * service and the parity tests run the exact decision code the daemons and Android run, so a
 * mock-backed e2e test exercises real gating, schedules, pools and overrides.
 *
 * Rebuild with `pnpm build:engine-wasm` after changing the engine.
 */

import type {
  Applied,
  Auth,
  Command,
  Ctx,
  Decision,
  EffectivePolicy,
  EngineSnapshot,
  EngineState,
  Gate,
  Policy,
  PopupInfo,
  PopupTarget,
  ProfileConfig,
  Tick,
} from '@talysman/shared';
import { classifyUrl as wasmClassifyUrl, initSync, relaxations as wasmRelaxations, validateConfig as wasmValidateConfig, WasmEngine } from '../pkg/engine.js';
import wasmBase64 from '../pkg/wasm-bytes.js';

let initialized = false;

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function ensureInitialized(): void {
  if (initialized) return;
  initSync({ module: decodeBase64(wasmBase64) });
  initialized = true;
}

/** An engine refusal (`EngineError`): `code` is one of the service error codes. */
export class EngineCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EngineCallError';
  }
}

/** Rethrow a wasm `JsError` carrying `EngineError` JSON as an `EngineCallError`. */
function translate(error: unknown): never {
  if (error instanceof Error) {
    let parsed: { code?: string; message?: string } | undefined;
    try {
      parsed = JSON.parse(error.message) as { code?: string; message?: string };
    } catch {
      parsed = undefined;
    }
    if (parsed?.code) throw new EngineCallError(parsed.code, parsed.message ?? parsed.code);
  }
  throw error;
}

function call<T>(run: () => string): T {
  let json: string;
  try {
    json = run();
  } catch (error) {
    translate(error);
  }
  return JSON.parse(json) as T;
}

/** The current wall clock and local UTC offset as the engine wants them. */
export function ctxAt(nowMs: number, hasPairedKeys: boolean, maxProfiles?: number | null): Ctx {
  return {
    now: { epochMs: nowMs, utcOffsetS: -new Date(nowMs).getTimezoneOffset() * 60 },
    hasPairedKeys,
    limits: { maxProfiles: maxProfiles ?? null },
  };
}

export class Engine {
  private constructor(private readonly inner: WasmEngine) {}

  static load(state: EngineState | string): Engine {
    ensureInitialized();
    const json = typeof state === 'string' ? state : JSON.stringify(state);
    try {
      return new Engine(new WasmEngine(json));
    } catch (error) {
      translate(error);
    }
  }

  static empty(deviceId: string): Engine {
    ensureInitialized();
    return new Engine(WasmEngine.empty(deviceId));
  }

  /** Upgrade a v5 daemon state document (profiles + global schedule + focus flag). */
  static fromV5(v5: unknown, deviceId: string, defaultColor: string, everEnabled: boolean, ctx: Ctx): Engine {
    ensureInitialized();
    try {
      return new Engine(WasmEngine.fromV5(JSON.stringify(v5), deviceId, defaultColor, everEnabled, JSON.stringify(ctx)));
    } catch (error) {
      translate(error);
    }
  }

  export(): EngineState {
    return JSON.parse(this.inner.export()) as EngineState;
  }

  gate(command: Command, ctx: Ctx): Gate {
    return call(() => this.inner.gate(JSON.stringify(command), JSON.stringify(ctx)));
  }

  /** Throws `EngineCallError` (KEY_REQUIRED, LOCKED, POOL_EXHAUSTED, …) when refused. */
  apply(command: Command, auth: Auth, ctx: Ctx): Applied {
    return call(() => this.inner.apply(JSON.stringify(command), JSON.stringify(auth), JSON.stringify(ctx)));
  }

  tick(ctx: Ctx): Tick {
    return call(() => this.inner.tick(JSON.stringify(ctx)));
  }

  snapshot(ctx: Ctx): EngineSnapshot {
    return call(() => this.inner.snapshot(JSON.stringify(ctx)));
  }

  /** The flat policy the desktop network layer enforces. */
  networkPolicy(ctx: Ctx): Policy {
    return call(() => this.inner.networkPolicy(JSON.stringify(ctx)));
  }

  effective(ctx: Ctx): EffectivePolicy {
    return call(() => this.inner.effective(JSON.stringify(ctx)));
  }

  popupInfo(target: PopupTarget, ctx: Ctx): PopupInfo {
    return call(() => this.inner.popupInfo(JSON.stringify(target), JSON.stringify(ctx)));
  }

  decideUrl(url: string, extensionCapable: boolean, ctx: Ctx): Decision {
    return call(() => this.inner.decideUrl(url, extensionCapable, JSON.stringify(ctx)));
  }
}

/** Every way `next` loosens `prev`; empty when it's at least as restrictive. */
export function relaxations(prev: ProfileConfig, next: ProfileConfig, nowMs: number): string[] {
  ensureInitialized();
  return call(() => wasmRelaxations(JSON.stringify(prev), JSON.stringify(next), nowMs));
}

/** The engine's validation message for a config, or null when it's valid. */
export function validateConfig(config: ProfileConfig): string | null {
  ensureInitialized();
  return wasmValidateConfig(JSON.stringify(config)) || null;
}

export function classifyUrl(url: string): { site: string; feature: string; route: number } | null {
  ensureInitialized();
  return JSON.parse(wasmClassifyUrl(url)) as { site: string; feature: string; route: number } | null;
}
