/* tslint:disable */
/* eslint-disable */

export class WasmEngine {
    free(): void;
    [Symbol.dispose](): void;
    apply(command_json: string, auth_json: string, ctx_json: string): string;
    decideUrl(url: string, extension_capable: boolean, ctx_json: string): string;
    effective(ctx_json: string): string;
    /**
     * A fresh engine with no profiles.
     */
    static empty(device_id: string): WasmEngine;
    export(): string;
    /**
     * Upgrade a v5 daemon state document.
     */
    static fromV5(v5_json: string, device_id: string, default_color: string, ever_enabled: boolean, ctx_json: string): WasmEngine;
    gate(command_json: string, ctx_json: string): string;
    /**
     * The flat policy the desktop network layer would enforce.
     */
    networkPolicy(ctx_json: string): string;
    /**
     * Load persisted `EngineState` JSON.
     */
    constructor(state_json: string);
    popupInfo(target_json: string, ctx_json: string): string;
    snapshot(ctx_json: string): string;
    tick(ctx_json: string): string;
}

/**
 * `{ site, feature, route }` for a URL the catalog owns, or `null`.
 */
export function classifyUrl(url: string): string;

/**
 * Every way `next` loosens `prev` (empty when it is at least as restrictive).
 */
export function relaxations(prev_json: string, next_json: string, now_ms: number): string;

/**
 * Validation the engine applies to incoming configs; returns the error message or "".
 */
export function validateConfig(config_json: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmengine_free: (a: number, b: number) => void;
    readonly classifyUrl: (a: number, b: number, c: number) => void;
    readonly relaxations: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly validateConfig: (a: number, b: number, c: number) => void;
    readonly wasmengine_apply: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly wasmengine_decideUrl: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly wasmengine_effective: (a: number, b: number, c: number, d: number) => void;
    readonly wasmengine_empty: (a: number, b: number) => number;
    readonly wasmengine_export: (a: number, b: number) => void;
    readonly wasmengine_fromV5: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly wasmengine_gate: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmengine_networkPolicy: (a: number, b: number, c: number, d: number) => void;
    readonly wasmengine_new: (a: number, b: number, c: number) => void;
    readonly wasmengine_popupInfo: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmengine_snapshot: (a: number, b: number, c: number, d: number) => void;
    readonly wasmengine_tick: (a: number, b: number, c: number, d: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
