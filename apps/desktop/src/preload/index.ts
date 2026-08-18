/**
 * The security boundary (architecture §15). Via contextBridge we expose a small, typed
 * `window.api` and nothing else — no Node, no ipcRenderer, no require leak into the UI.
 *
 * The renderer calls `api.request(method, params)` (typed in lib/bridge.ts) and subscribes
 * to pushed service events via `api.onServiceEvent`.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { TransitionKind, UsageTransition } from '@talysman/shared';
import type { CheckoutPrice, SubscriptionPlan } from '../shared/productLimits.js';
import type { AppPickerItem } from '../shared/appPicker.js';

const Channels = {
  serviceRequest: 'service:request',
  serviceEvent: 'service:event',
  devToggleKey: 'app:devToggleKey',
  devSimulateExtension: 'app:devSimulateExtension',
  devPushUsageTransition: 'app:devPushUsageTransition',
  entitlement: 'app:entitlement',
  devSetEntitlementPlan: 'app:devSetEntitlementPlan',
  setLocalEntitlementEnabled: 'app:setLocalEntitlementEnabled',
  openExternal: 'app:openExternal',
  appInfo: 'app:info',
  checkForUpdates: 'app:checkForUpdates',
  uninstallService: 'app:uninstallService',
  listInstalledApps: 'app:listInstalledApps',
  authStatus: 'app:authStatus',
  signInGoogle: 'app:signInGoogle',
  signInPassword: 'app:signInPassword',
  signUpPassword: 'app:signUpPassword',
  sendPasswordReset: 'app:sendPasswordReset',
  updatePassword: 'app:updatePassword',
  signOut: 'app:signOut',
  startCheckout: 'app:startCheckout',
  openBillingPortal: 'app:openBillingPortal',
  subscriptionDetail: 'app:subscriptionDetail',
  cancelSubscription: 'app:cancelSubscription',
  resumeSubscription: 'app:resumeSubscription',
  redeemCode: 'app:redeemCode',
  onboardingStatus: 'app:onboardingStatus',
  completeOnboarding: 'app:completeOnboarding',
  resetOnboarding: 'app:resetOnboarding',
  getTelemetryEnabled: 'app:getTelemetryEnabled',
  setTelemetryEnabled: 'app:setTelemetryEnabled',
  appEvent: 'app:event',
} as const;

export interface OnboardingStatusInfo {
  complete: boolean;
  completedAt?: string;
  version?: number;
}

export interface EntitlementInfo {
  active: boolean;
  plan: SubscriptionPlan;
  source: string;
}

export interface AuthStatusInfo {
  signedIn: boolean;
  email?: string;
  /** Set while a password-recovery session awaits a new password. */
  passwordRecovery?: boolean;
  /** Friendly error from the latest browser-based authentication callback. */
  authError?: string;
}

export interface SubscriptionDetailInfo {
  hasSubscription: boolean;
  plan: SubscriptionPlan;
  status?: string;
  price?: CheckoutPrice;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: string;
  canceledAt?: string | null;
}

export type AppEventName = 'authChanged' | 'entitlementChanged';

export interface ActionResult {
  ok: boolean;
  message?: string;
}

export type UninstallServiceResult =
  | { ok: true }
  | { ok: false; blocked: boolean; message: string };

export type AppUpdateCheckResult =
  | { status: 'up-to-date'; version: string }
  | { status: 'update-available'; version: string }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string };

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

  appInfo: (): Promise<{
    appVersion: string;
    appEnv: string;
    isLocalRelease: boolean;
    localEntitlementEnabled: boolean;
    usingMock: boolean;
    serviceConnected: boolean;
    platform: NodeJS.Platform;
  }> => ipcRenderer.invoke(Channels.appInfo),

  checkForUpdates: (): Promise<AppUpdateCheckResult> =>
    ipcRenderer.invoke(Channels.checkForUpdates),

  /** Remove the privileged background service. macOS-only; see uninstaller.ts for why. */
  uninstallService: (): Promise<UninstallServiceResult> =>
    ipcRenderer.invoke(Channels.uninstallService),

  listInstalledApps: (): Promise<AppPickerItem[]> =>
    ipcRenderer.invoke(Channels.listInstalledApps),

  openExternal: (url: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(Channels.openExternal, url),

  /** Dev-only: toggle the simulated USB key when running against the mock service. */
  devToggleKey: (): Promise<{ ok: boolean; present?: boolean; message?: string }> =>
    ipcRenderer.invoke(Channels.devToggleKey),

  /** Dev-only: emit one fake extension heartbeat from the mock service. */
  devSimulateExtension: (): Promise<ActionResult> =>
    ipcRenderer.invoke(Channels.devSimulateExtension),

  /** Dev-only: push one fake exact-usage transition into the mock service's usage log. */
  devPushUsageTransition: (
    kind: TransitionKind,
  ): Promise<ActionResult & { transition?: UsageTransition }> =>
    ipcRenderer.invoke(Channels.devPushUsageTransition, kind),

  entitlement: (): Promise<EntitlementInfo> =>
    ipcRenderer.invoke(Channels.entitlement),

  /** Dev-only: override the simulated subscription plan. */
  devSetEntitlementPlan: (
    plan: SubscriptionPlan,
  ): Promise<{ ok: boolean; entitlement?: EntitlementInfo; message?: string }> =>
    ipcRenderer.invoke(Channels.devSetEntitlementPlan, plan),

  /** release:local-only: temporarily bypass the signed local Pro entitlement. */
  setLocalEntitlementEnabled: (
    enabled: boolean,
  ): Promise<{
    ok: boolean;
    enabled?: boolean;
    entitlement?: EntitlementInfo;
    message?: string;
  }> => ipcRenderer.invoke(Channels.setLocalEntitlementEnabled, enabled),

  // --- auth ---
  authStatus: (): Promise<AuthStatusInfo> => ipcRenderer.invoke(Channels.authStatus),
  signInGoogle: (): Promise<ActionResult> => ipcRenderer.invoke(Channels.signInGoogle),
  signInPassword: (email: string, password: string): Promise<ActionResult> =>
    ipcRenderer.invoke(Channels.signInPassword, { email, password }),
  signUpPassword: (
    email: string,
    password: string,
    fullName?: string,
  ): Promise<ActionResult & { confirmEmail?: boolean }> =>
    ipcRenderer.invoke(Channels.signUpPassword, { email, password, fullName }),
  sendPasswordReset: (email: string): Promise<ActionResult> =>
    ipcRenderer.invoke(Channels.sendPasswordReset, { email }),
  updatePassword: (password: string): Promise<ActionResult> =>
    ipcRenderer.invoke(Channels.updatePassword, { password }),
  signOut: (): Promise<ActionResult> => ipcRenderer.invoke(Channels.signOut),

  // --- billing ---
  startCheckout: (price: CheckoutPrice): Promise<ActionResult> =>
    ipcRenderer.invoke(Channels.startCheckout, price),
  openBillingPortal: (): Promise<ActionResult> =>
    ipcRenderer.invoke(Channels.openBillingPortal),
  subscriptionDetail: (): Promise<
    ActionResult & { detail?: SubscriptionDetailInfo }
  > => ipcRenderer.invoke(Channels.subscriptionDetail),
  cancelSubscription: (): Promise<ActionResult> =>
    ipcRenderer.invoke(Channels.cancelSubscription),
  resumeSubscription: (): Promise<ActionResult> =>
    ipcRenderer.invoke(Channels.resumeSubscription),
  /** Redeem a complimentary-access code. `granted` is true once the account holds Pro. */
  redeemCode: (code: string): Promise<ActionResult & { granted?: boolean }> =>
    ipcRenderer.invoke(Channels.redeemCode, { code }),

  // --- first run ---
  /** Whether the first-run walkthrough has already been completed on this machine. */
  onboardingStatus: (): Promise<OnboardingStatusInfo> =>
    ipcRenderer.invoke(Channels.onboardingStatus),
  /** Mark the first-run walkthrough as done so it doesn't reappear. */
  completeOnboarding: (): Promise<OnboardingStatusInfo> =>
    ipcRenderer.invoke(Channels.completeOnboarding),
  /** Dev-only: forget the first run so the walkthrough replays on the next launch. */
  resetOnboarding: (): Promise<
    ActionResult & { status?: OnboardingStatusInfo }
  > => ipcRenderer.invoke(Channels.resetOnboarding),

  // --- telemetry ---
  /** Whether local product-analytics telemetry is enabled (default on). */
  getTelemetryEnabled: (): Promise<boolean> => ipcRenderer.invoke(Channels.getTelemetryEnabled),
  /** Toggle local product-analytics telemetry. */
  setTelemetryEnabled: (enabled: boolean): Promise<ActionResult & { enabled?: boolean }> =>
    ipcRenderer.invoke(Channels.setTelemetryEnabled, enabled),

  /** Subscribe to main-pushed auth/entitlement change events. Returns an unsubscribe fn. */
  onAppEvent: (cb: (event: AppEventName) => void): (() => void) => {
    const listener = (_e: unknown, msg: { event: AppEventName }) => cb(msg.event);
    ipcRenderer.on(Channels.appEvent, listener);
    return () => ipcRenderer.removeListener(Channels.appEvent, listener);
  },
};

export type TalysmanApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
