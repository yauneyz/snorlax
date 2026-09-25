/**
 * ipcMain handlers the preload calls into. They translate UI intents into service RPCs and
 * forward pushed service events to every renderer. Auth/payment intents are stubbed until
 * Phase 3.
 */

import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron';
import {
  ErrorCode,
  profileInput,
  type AppRef,
  type Command,
  type EventName,
  type Method,
  type Params,
  type Policy,
  type ServiceState,
  type TransitionKind,
} from '@talysman/shared';
import { policyUsesJudge, productFeaturesForEnvironment } from '@talysman/product';
import { config } from '../config.js';
import { logger } from '../logging.js';
import { listInstalledApps } from '../appDiscovery.js';
import { checkForAppUpdates } from '../updater.js';
import { isServiceError, type ServiceConnection } from '../service/connection.js';
import type { MockServiceConnection } from '../service/mockService.js';
import { uninstallService } from '../service/uninstaller.js';
import { flushEvents, track } from '../analytics.js';
import { loadDeviceIdentity } from '../deviceIdentity.js';
import {
  getEntitlement,
  invalidateEntitlementCache,
  isLocalEntitlementEnabled,
  setDevEntitlementPlan,
  setLocalEntitlementEnabled,
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
  redeemCompCode,
  resumeSubscription,
  startCheckout,
} from '../auth/billing.js';
import {
  type CheckoutPrice,
  constrainConfigToLimits,
  constrainProfilesToLimits,
  limitsForPlan,
  maxProfiles,
  validateConfigForLimits,
  validateProfilesForLimits,
  type SubscriptionPlan,
} from '../../shared/productLimits.js';
import { completeOnboarding, getOnboardingStatus, resetOnboarding } from '../onboarding.js';
import { getAiModeEnabled, setAiModeEnabled } from '../aiMode.js';
import { Channels } from './channels.js';
import { closeUnlockPopup, showUnlockPopup } from '../popupWindow.js';

/** Events pushed to renderers so the UI re-pulls auth/entitlement after a change. */
export type AppEvent = 'authChanged' | 'entitlementChanged' | 'openOverrides';

let activeService: ServiceConnection | undefined;
const features = productFeaturesForEnvironment(config.appEnv);

/** Broadcast an app-level event to every renderer window. */
export function broadcastAppEvent(event: AppEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(Channels.appEvent, { event });
  }
}

/** Re-constrain service state to the current plan's limits (after sign-in / billing return). */
export async function applyPlanLimitsNow(): Promise<void> {
  invalidateEntitlementCache();
  if (activeService) await applyCurrentPlanLimits(activeService);
}

const FORWARDED_EVENTS: EventName[] = [
  'stateChanged',
  'keyPresenceChanged',
  'focusChanged',
  'policyChanged',
  'scheduleFired',
  'settingsChanged',
  'browserWatchdogWarning',
  'browserWatchdogKilled',
  'extensionHeartbeat',
];

const WATCHDOG_KILLED_DETAIL =
  'The browser could not prove that the Talysman extension was active during locked Focus mode. ' +
  'Enable or reinstall the extension, allow its permissions, and then reopen the browser. ' +
  'If this browser does not support the extension, use a supported browser instead.';

// Keep active notifications alive until the OS closes them so click handlers remain reliable.
const activeWatchdogNotifications = new Set<Notification>();

function showWatchdogKilledDialog(title: string): void {
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
    // Electron 42+ uses UNNotification on macOS, which rejects notifications from unsigned
    // apps. Local mac builds are intentionally unsigned, so preserve the warning via a dialog.
    notification.once('failed', (_event, error) => {
      activeWatchdogNotifications.delete(notification);
      logger.warn('[notification] native watchdog alert failed; using dialog fallback', error);
      showWatchdogKilledDialog(title);
    });
    notification.once('close', () => activeWatchdogNotifications.delete(notification));
    activeWatchdogNotifications.add(notification);
    try {
      notification.show();
    } catch (error) {
      activeWatchdogNotifications.delete(notification);
      logger.warn('[notification] native watchdog alert threw; using dialog fallback', error);
      showWatchdogKilledDialog(title);
    }
    return;
  }

  // Some minimal Linux desktops have no notification server. A native warning dialog is the
  // fallback so the explanation is still visible rather than silently disappearing.
  showWatchdogKilledDialog(title);
}

type IpcHandler = Parameters<typeof ipcMain.handle>[1];

/**
 * Thin wrapper around ipcMain.handle: any exception a handler throws (Electron already
 * forwards it to the renderer as a rejection, so behavior is unchanged) is also tracked and
 * flushed immediately, so a UI action failing repeatedly is visible instead of only ever
 * reaching the renderer's own error state.
 */
function ipcHandle(channel: string, fn: IpcHandler): void {
  ipcMain.handle(channel, async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      track('ipc_handler_error', {
        channel,
        message: error instanceof Error ? error.message : String(error),
      });
      void flushEvents();
      throw error;
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

function productionPolicyError(policy: Policy): string | undefined {
  if (features.smartFiltering) return undefined;
  if (policyUsesJudge(policy)) return 'AI filtering is not available in this build.';
  if (policy.defaultAction === 'allow' && policy.allowedDomains.length > 0) {
    return 'Blacklist mode cannot contain an allow list.';
  }
  if (policy.defaultAction === 'block' && policy.blockedDomains.length > 0) {
    return 'Whitelist mode cannot contain a block list.';
  }
  return undefined;
}

/**
 * Trim the daemon's profiles to the current plan (after sign-in, a downgrade, a billing return).
 * Free keeps one profile (the default one), caps each profile's lists, and drops recurring
 * schedule rules. Trimming can loosen a committed profile, which the service gates behind the
 * USB key — so a refused step leaves the stricter state until the user unlocks. That's the
 * intended fail-safe, so gate errors are logged instead of failing the whole sync.
 */
async function applyCurrentPlanLimits(service: ServiceConnection): Promise<void> {
  const limits = limitsForPlan((await getEntitlement()).plan);
  if (!limits) return;

  const state = await service.request('getState', undefined);
  const profiles = state.engine.profiles.map((status) => status.profile);
  const kept = constrainProfilesToLimits(profiles, state.engine.defaultProfileId, limits);
  for (const dropped of profiles) {
    if (kept.some((profile) => profile.id === dropped.id)) continue;
    await applyConstrainedCommand(service, { type: 'deleteProfile', profileId: dropped.id }, `profile "${dropped.name}"`);
  }
  for (const profile of kept) {
    const config = constrainConfigToLimits(profile.config, limits);
    if (JSON.stringify(config) === JSON.stringify(profile.config)) continue;
    await applyConstrainedCommand(
      service,
      { type: 'upsertProfile', profile: profileInput({ ...profile, config }) },
      `profile "${profile.name}"`,
    );
  }
}

/** Apply a plan-limit-constrained command, tolerating the service's key gate on any relaxation. */
async function applyConstrainedCommand(service: ServiceConnection, command: Command, label: string): Promise<void> {
  try {
    await service.request('applyCommand', { command });
  } catch (e) {
    if (isServiceError(e) && (e.code === 'KEY_REQUIRED' || e.code === 'LOCKED')) {
      logger.info(`[plan-limits] ${label} kept stricter than plan limits until unlocked`);
    } else {
      throw e;
    }
  }
}

/**
 * Plan and build checks on a UI command before it reaches the service: the daemon doesn't know
 * the user's plan. Returns an error message, or undefined to let it through.
 */
async function commandLimitError(
  service: ServiceConnection,
  command: Command,
  limits: ReturnType<typeof limitsForPlan>,
  state: () => Promise<ServiceState>,
): Promise<string | undefined> {
  if (command.type === 'upsertProfile') {
    const featureError = productionPolicyError(command.profile.config.policy);
    if (featureError) return featureError;
    const violations = validateConfigForLimits(command.profile.config, limits);
    if (violations[0]) return violations[0].message;
  }
  const creates =
    command.type === 'duplicateProfile'
    || (command.type === 'upsertProfile'
      && !(await state()).engine.profiles.some((p) => p.profile.id === command.profile.id));
  if (creates && maxProfiles(limits) !== null) {
    const profiles = (await state()).engine.profiles;
    const violations = validateProfilesForLimits([...profiles, null], limits);
    if (violations[0]) return violations[0].message;
  }
  void service;
  return undefined;
}

export async function registerIpcHandlers(ctx: HandlerContext): Promise<void> {
  const { service, mock } = ctx;
  activeService = service;
  await applyCurrentPlanLimits(service);

  // When the Supabase session changes (sign-in/out, token refresh), re-apply plan limits and
  // tell renderers to re-pull auth + entitlement.
  setAuthChangeListener(() => {
    invalidateEntitlementCache();
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

  // A blocked desktop app was just closed: offer the unlock popup.
  service.on('appBlocked', ({ app }) => showUnlockPopup(app));

  ipcHandle(Channels.serviceRequest, async (_e, arg: { method: Method; params: unknown }) => {
    try {
      const limits = limitsForPlan((await getEntitlement()).plan);
      let before: ServiceState | undefined;
      const state = async () => (before ??= await service.request('getState', undefined));

      if (arg.method === 'applyCommand') {
        const params = arg.params as Params<'applyCommand'>;
        if (!params.dryRun) {
          const limitError_ = await commandLimitError(service, params.command, limits, state);
          if (limitError_) return limitError(limitError_);
        }
      }

      // `schedule_created` (first recurring rule on a profile) vs `schedule_edited` (a return
      // visit changing an existing setup) is read from state *before* the call.
      let scheduleEvent: 'schedule_created' | 'schedule_edited' | undefined;
      if (arg.method === 'applyCommand') {
        const { command, dryRun } = arg.params as Params<'applyCommand'>;
        if (!dryRun && command.type === 'upsertProfile') {
          const previous = (await state()).engine.profiles.find((p) => p.profile.id === command.profile.id)?.profile;
          const prevSchedule = JSON.stringify(previous?.config.schedule ?? []);
          if (prevSchedule !== JSON.stringify(command.profile.config.schedule)) {
            scheduleEvent = (previous?.config.schedule.length ?? 0) > 0 ? 'schedule_edited' : 'schedule_created';
          }
        }
      }

      const result = await service.request(arg.method, arg.params as Params<Method>);
      if (arg.method === 'pairKey') track('usb_key_paired');
      if (scheduleEvent) track(scheduleEvent);
      return { ok: true, result };
    } catch (e) {
      if (arg.method === 'pairKey') {
        track('usb_pair_failed', { reason: e instanceof Error ? e.message : String(e) });
      }
      if (isServiceError(e)) return { ok: false, code: e.code, message: e.message };
      logger.error('[ipc] unexpected service error', e);
      return { ok: false, code: 'INTERNAL', message: (e as Error).message };
    }
  });

  ipcHandle(Channels.closePopup, () => {
    closeUnlockPopup();
    return { ok: true };
  });

  ipcHandle(Channels.openOverrides, async () => {
    closeUnlockPopup();
    const { showMainWindow } = await import('../window.js');
    const win = showMainWindow();
    win?.webContents.send(Channels.appEvent, { event: 'openOverrides' });
    return { ok: true };
  });

  ipcHandle(Channels.devSimulateAppBlocked, (_e, app: AppRef) => {
    if (!mock) return { ok: false, message: 'Only available against the mock service.' };
    mock.devSimulateAppBlocked(app);
    return { ok: true };
  });

  ipcHandle(Channels.appInfo, async () => {
    const { identity } = await loadDeviceIdentity();
    return {
      appVersion: app.getVersion(),
      appEnv: config.appEnv,
      isDev: config.isDev,
      isLocalRelease: config.isLocalRelease,
      localEntitlementEnabled: config.isLocalRelease && isLocalEntitlementEnabled(),
      usingMock: Boolean(mock),
      serviceConnected: service.connected,
      platform: process.platform,
      // Session replay identity only — no email/PII (architecture §3.15).
      deviceId: identity.deviceId,
      posthogKey: config.posthogKey,
      posthogHost: config.posthogHost,
    };
  });

  ipcHandle(Channels.checkForUpdates, () => checkForAppUpdates());

  ipcHandle(Channels.uninstallService, () => uninstallService(service));

  ipcHandle(Channels.listInstalledApps, () => listInstalledApps());

  ipcHandle(Channels.openExternal, async (_e, url: string) => {
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcHandle(Channels.devToggleKey, () => {
    if (!mock) return { ok: false, message: 'Only available against the mock service.' };
    return { ok: true, present: mock.devToggleKey() };
  });

  ipcHandle(Channels.devSimulateExtension, () => {
    if (!mock) return { ok: false, message: 'Only available against the mock service.' };
    mock.devSimulateExtensionHeartbeat();
    return { ok: true };
  });

  ipcHandle(Channels.devPushUsageTransition, (_e, kind: TransitionKind) => {
    if (!mock) return { ok: false, message: 'Only available against the mock service.' };
    return { ok: true, transition: mock.devPushUsageTransition(kind) };
  });

  ipcHandle(Channels.entitlement, () => getEntitlement());

  ipcHandle(Channels.devSetEntitlementPlan, async (_e, plan: SubscriptionPlan) => {
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

  ipcHandle(Channels.setLocalEntitlementEnabled, async (_e, enabled: boolean) => {
    if (!config.isLocalRelease) {
      return { ok: false, message: 'Only available in release:local builds.' };
    }
    if (typeof enabled !== 'boolean') {
      return { ok: false, message: 'Expected an enabled state.' };
    }

    setLocalEntitlementEnabled(enabled);
    const entitlement = await getEntitlement();
    await applyCurrentPlanLimits(service);
    broadcastAppEvent('entitlementChanged');
    return { ok: true, enabled, entitlement };
  });

  // --- auth ---
  ipcHandle(Channels.authStatus, () => getAuthStatus());
  ipcHandle(Channels.signInGoogle, () => signInWithGoogle());
  ipcHandle(
    Channels.signInPassword,
    (_e, creds: { email: string; password: string }) =>
      signInWithPassword(creds.email, creds.password),
  );
  ipcHandle(
    Channels.signUpPassword,
    async (_e, creds: { email: string; password: string; fullName?: string }) => {
      const result = await signUpWithPassword(creds.email, creds.password, creds.fullName);
      if (result.ok) {
        track('account_created', { method: 'password', surface: 'desktop' });
        // Flush now rather than waiting for the 15-minute tick: when sign-up returned a
        // session, postTrackEvent's Authorization header carries it and the row lands with
        // user_id already attached. Delaying risks it going out anonymous and resolving
        // through device_id alone.
        if (!result.confirmEmail) void flushEvents();
      }
      return result;
    },
  );
  ipcHandle(Channels.sendPasswordReset, (_e, args: { email: string }) =>
    sendPasswordReset(args.email),
  );
  ipcHandle(Channels.updatePassword, async (_e, args: { password: string }) => {
    const result = await updatePassword(args.password);
    if (result.ok) broadcastAppEvent('authChanged');
    return result;
  });
  ipcHandle(Channels.signOut, () => signOut());

  // --- billing ---
  ipcHandle(Channels.startCheckout, (_e, price: CheckoutPrice) => startCheckout(price));
  ipcHandle(Channels.openBillingPortal, () => openBillingPortal());
  ipcHandle(Channels.subscriptionDetail, () => fetchSubscriptionDetail());
  ipcHandle(Channels.cancelSubscription, async () => {
    const result = await cancelSubscription();
    if (result.ok) {
      await applyPlanLimitsNow();
      broadcastAppEvent('entitlementChanged');
    }
    return result;
  });
  ipcHandle(Channels.resumeSubscription, async () => {
    const result = await resumeSubscription();
    if (result.ok) {
      await applyPlanLimitsNow();
      broadcastAppEvent('entitlementChanged');
    }
    return result;
  });
  // --- first run ---
  ipcHandle(Channels.onboardingStatus, () => getOnboardingStatus());
  ipcHandle(Channels.completeOnboarding, async () => {
    const status = await completeOnboarding();
    track('onboarding_completed');
    return status;
  });
  ipcHandle(Channels.resetOnboarding, async () => {
    if (config.appEnv === 'production' && !config.isLocalRelease) {
      return { ok: false, message: 'Only available in development builds.' };
    }
    return { ok: true, status: await resetOnboarding() };
  });

  // --- AI mode ---
  ipcHandle(Channels.aiModeStatus, async () => ({ enabled: await getAiModeEnabled(service) }));
  ipcHandle(Channels.setAiMode, async (_e, args: { enabled: boolean }) => {
    await setAiModeEnabled(service, args?.enabled === true);
    return { enabled: await getAiModeEnabled(service) };
  });

  ipcHandle(Channels.reportRendererError, (_e, args: { message: string; stack?: string }) => {
    track('renderer_error', { message: args.message, stack: args.stack?.slice(0, 4000) });
    void flushEvents();
  });

  ipcHandle(Channels.redeemCode, async (_e, args: { code: string }) => {
    const result = await redeemCompCode(String(args?.code ?? ''));
    if (result.granted) {
      await applyPlanLimitsNow();
      broadcastAppEvent('entitlementChanged');
    }
    return result;
  });
}
