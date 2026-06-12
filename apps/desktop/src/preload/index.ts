/**
 * The security boundary (architecture §15). Via contextBridge we expose a small, typed
 * `window.api` and nothing else — no Node, no ipcRenderer, no require leak into the UI.
 *
 * The renderer calls `api.request(method, params)` (typed in lib/bridge.ts) and subscribes
 * to pushed service events via `api.onServiceEvent`.
 */

import { contextBridge, ipcRenderer } from 'electron';

const Channels = {
  serviceRequest: 'service:request',
  serviceEvent: 'service:event',
  devToggleKey: 'app:devToggleKey',
  openExternal: 'app:openExternal',
  appInfo: 'app:info',
} as const;

export interface ServiceResponse {
  ok: boolean;
  result?: unknown;
  code?: string;
  message?: string;
}

const api = {
  /** Issue a typed RPC to the service via main. Returns the unwrapped response envelope. */
  request: (method: string, params: unknown): Promise<ServiceResponse> =>
    ipcRenderer.invoke(Channels.serviceRequest, { method, params }),

  /** Subscribe to pushed service events. Returns an unsubscribe function. */
  onServiceEvent: (cb: (msg: { event: string; payload: unknown }) => void): (() => void) => {
    const listener = (_e: unknown, msg: { event: string; payload: unknown }) => cb(msg);
    ipcRenderer.on(Channels.serviceEvent, listener);
    return () => ipcRenderer.removeListener(Channels.serviceEvent, listener);
  },

  appInfo: (): Promise<{ appEnv: string; usingMock: boolean; serviceConnected: boolean }> =>
    ipcRenderer.invoke(Channels.appInfo),

  openExternal: (url: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(Channels.openExternal, url),

  /** Dev-only: toggle the simulated USB key when running against the mock service. */
  devToggleKey: (): Promise<{ ok: boolean; present?: boolean; message?: string }> =>
    ipcRenderer.invoke(Channels.devToggleKey),
};

export type FocusLockApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
