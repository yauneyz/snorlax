/**
 * Typed wrapper over the preload `window.api`. Gives the UI strongly-typed RPC calls and
 * event subscriptions that feed the zustand store.
 */

import type {
  EventMap,
  EventName,
  Method,
  Params,
  Result,
} from '@focuslock/shared';
import type { SubscriptionPlan } from '../../shared/productLimits.js';
import type { AppPickerItem } from '../../shared/appPicker.js';

export interface BridgeError extends Error {
  code: string;
}

function bridgeError(code: string, message: string): BridgeError {
  const e = new Error(message) as BridgeError;
  e.code = code;
  return e;
}

/** Issue a typed RPC. Throws a BridgeError carrying `code` on failure. */
export async function request<M extends Method>(method: M, params: Params<M>): Promise<Result<M>> {
  const res = await window.api.request(method, params);
  if (!res.ok) throw bridgeError(res.code ?? 'INTERNAL', res.message ?? 'Request failed');
  return res.result as Result<M>;
}

/** Subscribe to a specific pushed service event. Returns an unsubscribe function. */
export function onEvent<E extends EventName>(event: E, cb: (payload: EventMap[E]) => void): () => void {
  return window.api.onServiceEvent((msg) => {
    if (msg.event === event) cb(msg.payload as EventMap[E]);
  });
}

export const appInfo = () => window.api.appInfo();
export const listInstalledApps = (): Promise<AppPickerItem[]> => window.api.listInstalledApps();
export const openExternal = (url: string) => window.api.openExternal(url);
export const devToggleKey = () => window.api.devToggleKey();
export const entitlement = () => window.api.entitlement();
export const devSetEntitlementPlan = (plan: SubscriptionPlan) =>
  window.api.devSetEntitlementPlan(plan);
export type { SubscriptionPlan };
