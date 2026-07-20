/**
 * ipcMain handlers the preload calls into. They translate UI intents into service RPCs and
 * forward pushed service events to every renderer. Auth/payment intents are stubbed until
 * Phase 3.
 */

import { BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron';
import { ErrorCode, type EventName, type Method, type Params } from '@talysman/shared';
import { config } from '../config.js';
import { logger } from '../logging.js';
import { listInstalledApps } from '../appDiscovery.js';
import { isServiceError, type ServiceConnection } from '../service/connection.js';
import type { MockServiceConnection } from '../service/mockService.js';
import {
  getEntitlement,
  setDevEntitlementPlan,
} from '../auth/subscription.js';
import {
  getAuthStatus,
  sendPasswordReset,
  setAuthChangeListener,
  signInWithGoogle,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  updatePassword,
} from '../auth/supabase.js';
import {
  cancelSubscription,
  fetchSubscriptionDetail,
  openBillingPortal,
  resumeSubscription,
  startCheckout,
} from '../auth/billing.js';
import {
  type CheckoutPrice,
  constrainPolicyToLimits,
  constrainScheduleToLimits,
  limitsForPlan,
  validatePolicyForLimits,
  validateScheduleForLimits,
  type SubscriptionPlan,
} from '../../shared/productLimits.js';
import { Channels } from './channels.js';

/** Events pushed to renderers so the UI re-pulls auth/entitlement after a change. */
export type AppEvent = 'authChanged' | 'entitlementChanged';

let activeService: ServiceConnection | undefined;

/** Broadcast an app-level event to every renderer window. */
export function broadcastAppEvent(event: AppEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(Channels.appEvent, { event });
  }
}

/** Re-constrain service state to the current plan's limits (after sign-in / billing return). */
export async function applyPlanLimitsNow(): Promise<void> {
  if (activeService) await applyCurrentPlanLimits(activeService);
}

const FORWARDED_EVENTS: EventName[] = [
  'keyPresenceChanged',
  'focusChanged',
  'policyChanged',
  'scheduleFired',
  'settingsChanged',
  'browserWatchdogWarning',
  'browserWatchdogKilled',
];

const WATCHDOG_KILLED_DETAIL =
  'The browser could not prove that the Talysman extension was active during locked Focus mode. ' +
  'Enable or reinstall the extension, allow its permissions, and then reopen the browser. ' +
  'If this browser does not support the extension, use a supported browser instead.';

/** Show the kill explanation in the logged-in desktop session, not the privileged service session. */
function notifyBrowserWatchdogKilled(browser: string): void {
  const title = `Talysman closed ${browser}`;

  if (Notification.isSupported()) {
    const notification = new Notification({
      title,
      body: WATCHDOG_KILLED_DETAIL,
      urgency: 'critical',
      timeoutType: 'never',
      silent: false,
    });
    notification.on('click', () => {
      void import('../window.js').then(({ showMainWindow }) => showMainWindow());
    });
    notification.show();
    return;
  }

  // Some minimal Linux desktops have no notification server. A native warning dialog is the
  // fallback so the explanation is still visible rather than silently disappearing.
  void dialog
    .showMessageBox({
      type: 'warning',
      title,
      message: title,
      detail: WATCHDOG_KILLED_DETAIL,
      buttons: ['Open Talysman', 'Dismiss'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    .then(({ response }) => {
      if (response === 0) {
        void import('../window.js').then(({ showMainWindow }) => showMainWindow());
      }
    });
}

export interface HandlerContext {
  service: ServiceConnection;
  /** Present only when running against the in-process mock (dev/WSL). */
  mock?: MockServiceConnection;
}

function limitError(message: string) {
  return { ok: false, code: ErrorCode.BAD_REQUEST, message };
}

async function applyCurrentPlanLimits(service: ServiceConnection): Promise<void> {
  const limits = limitsForPlan((await getEntitlement()).plan);
  if (!limits) return;

  const state = await service.request('getState', undefined);
  const policy = constrainPolicyToLimits(state.policy, limits);
  const schedule = constrainScheduleToLimits(state.schedule, limits);

  await service.request('setPolicy', { policy });
  await service.request('setSchedule', { schedule });
}

export async function registerIpcHandlers(ctx: HandlerContext): Promise<void> {
  const { service, mock } = ctx;
  activeService = service;
  await applyCurrentPlanLimits(service);

  // When the Supabase session changes (sign-in/out, token refresh), re-apply plan limits and
  // tell renderers to re-pull auth + entitlement.
  setAuthChangeListener(() => {
    void applyPlanLimitsNow();
    broadcastAppEvent('authChanged');
  });

  // Forward service events to all renderer windows.
  for (const event of FORWARDED_EVENTS) {
    service.on(event, (payload) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(Channels.serviceEvent, { event, payload });
      }
    });
  }

  service.on('browserWatchdogKilled', ({ browser }) => {
    notifyBrowserWatchdogKilled(browser);
  });

  ipcMain.handle(Channels.serviceRequest, async (_e, arg: { method: Method; params: unknown }) => {
    try {
      const limits = limitsForPlan((await getEntitlement()).plan);

      if (arg.method === 'setPolicy') {
        const params = arg.params as Params<'setPolicy'>;
        const violations = validatePolicyForLimits(params.policy, limits);
        if (violations[0]) return limitError(violations[0].message);
      }

      if (arg.method === 'setSchedule') {
        const params = arg.params as Params<'setSchedule'>;
        const violations = validateScheduleForLimits(params.schedule, limits);
        if (violations[0]) return limitError(violations[0].message);
      }

      const result = await service.request(arg.method, arg.params as Params<Method>);
      return { ok: true, result };
    } catch (e) {
      if (isServiceError(e)) return { ok: false, code: e.code, message: e.message };
      logger.error('[ipc] unexpected service error', e);
      return { ok: false, code: 'INTERNAL', message: (e as Error).message };
    }
  });

  ipcMain.handle(Channels.appInfo, () => ({
    appEnv: config.appEnv,
    usingMock: Boolean(mock),
    serviceConnected: service.connected,
  }));

  ipcMain.handle(Channels.listInstalledApps, () => listInstalledApps());

  ipcMain.handle(Channels.openExternal, async (_e, url: string) => {
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle(Channels.devToggleKey, () => {
    if (!mock) return { ok: false, message: 'Only available against the mock service.' };
    return { ok: true, present: mock.devToggleKey() };
  });

  ipcMain.handle(Channels.entitlement, () => getEntitlement());

  ipcMain.handle(Channels.devSetEntitlementPlan, async (_e, plan: SubscriptionPlan) => {
    if (config.appEnv === 'production') {
      return { ok: false, message: 'Only available in development builds.' };
    }

    if (plan !== 'free' && plan !== 'pro') {
      return { ok: false, message: 'Unknown subscription plan.' };
    }

    const entitlement = await setDevEntitlementPlan(plan);
    await applyCurrentPlanLimits(service);
    return { ok: true, entitlement };
  });

  // --- auth ---
  ipcMain.handle(Channels.authStatus, () => getAuthStatus());
  ipcMain.handle(Channels.signInGoogle, () => signInWithGoogle());
  ipcMain.handle(
    Channels.signInPassword,
    (_e, creds: { email: string; password: string }) =>
      signInWithPassword(creds.email, creds.password),
  );
  ipcMain.handle(
    Channels.signUpPassword,
    (_e, creds: { email: string; password: string; fullName?: string }) =>
      signUpWithPassword(creds.email, creds.password, creds.fullName),
  );
  ipcMain.handle(Channels.sendPasswordReset, (_e, args: { email: string }) =>
    sendPasswordReset(args.email),
  );
  ipcMain.handle(Channels.updatePassword, async (_e, args: { password: string }) => {
    const result = await updatePassword(args.password);
    if (result.ok) broadcastAppEvent('authChanged');
    return result;
  });
  ipcMain.handle(Channels.signOut, () => signOut());

  // --- billing ---
  ipcMain.handle(Channels.startCheckout, (_e, price: CheckoutPrice) => startCheckout(price));
  ipcMain.handle(Channels.openBillingPortal, () => openBillingPortal());
  ipcMain.handle(Channels.subscriptionDetail, () => fetchSubscriptionDetail());
  ipcMain.handle(Channels.cancelSubscription, async () => {
    const result = await cancelSubscription();
    if (result.ok) {
      await applyPlanLimitsNow();
      broadcastAppEvent('entitlementChanged');
    }
    return result;
  });
  ipcMain.handle(Channels.resumeSubscription, async () => {
    const result = await resumeSubscription();
    if (result.ok) {
      await applyPlanLimitsNow();
      broadcastAppEvent('entitlementChanged');
    }
    return result;
  });
}
