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
} from '@talysman/shared';
import type { CheckoutPrice, SubscriptionPlan } from '../../shared/productLimits.js';
import type { AppPickerItem } from '../../shared/appPicker.js';
import type { AppEventName, SubscriptionDetailInfo } from '../../preload/index.js';

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

/** Subscribe to main-pushed auth/entitlement change events. Returns an unsubscribe function. */
export function onAppEvent(cb: (event: AppEventName) => void): () => void {
  return window.api.onAppEvent(cb);
}

export const appInfo = () => window.api.appInfo();
export const listInstalledApps = (): Promise<AppPickerItem[]> => window.api.listInstalledApps();
export const openExternal = (url: string) => window.api.openExternal(url);
export const devToggleKey = () => window.api.devToggleKey();
export const entitlement = () => window.api.entitlement();
export const devSetEntitlementPlan = (plan: SubscriptionPlan) =>
  window.api.devSetEntitlementPlan(plan);

export const authStatus = () => window.api.authStatus();
export const signInGoogle = () => window.api.signInGoogle();
export const signInPassword = (email: string, password: string) =>
  window.api.signInPassword(email, password);
export const signUpPassword = (email: string, password: string, fullName?: string) =>
  window.api.signUpPassword(email, password, fullName);
export const sendPasswordReset = (email: string) => window.api.sendPasswordReset(email);
export const updatePassword = (password: string) => window.api.updatePassword(password);
export const signOut = () => window.api.signOut();
export const startCheckout = (price: CheckoutPrice) => window.api.startCheckout(price);
export const openBillingPortal = () => window.api.openBillingPortal();
export const subscriptionDetail = () => window.api.subscriptionDetail();
export const cancelSubscription = () => window.api.cancelSubscription();
export const resumeSubscription = () => window.api.resumeSubscription();
export const redeemCode = (code: string) => window.api.redeemCode(code);

export type { CheckoutPrice, SubscriptionPlan, SubscriptionDetailInfo };
