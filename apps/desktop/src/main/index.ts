/**
 * App entry: single-instance lock, talysman:// protocol registration, window + tray,
 * service connection (real pipe, or an explicitly requested in-process mock),
 * IPC handlers, service version reconciliation, and guarded auto-update.
 *
 * On Linux the tray icon is NOT owned by this process — the standalone `talysman-tray` helper
 * (native/linux/src/bin/tray.rs) talks to the daemon directly and renders it, so it keeps working
 * (and stays cheap) whether or not this Electron app is running. Windows/macOS don't have that
 * helper yet, so this process still creates its own tray there (see tray.ts) — only while it's
 * open, no persistence.
 *
 * `pnpm dev` intentionally shares the installed service with the production desktop client so
 * both windows and the existing browser extensions observe one authoritative blocker state.
 * UI-only development and E2E tests opt into the mock explicitly.
 */

import { app } from 'electron';
import { DEEP_LINK_SCHEME, PROTOCOL_VERSION } from '@talysman/shared';
import { productFeaturesForEnvironment } from '@talysman/product';
import { config } from './config.js';
import { logger } from './logging.js';
import { flushEvents, initAnalytics, recordAppOpen, shutdownFlush, track, trackAppInstalledIfFirstRun } from './analytics.js';
import { registerIpcHandlers } from './ipc/handlers.js';
import { PipeServiceConnection } from './service/client.js';
import { MockServiceConnection } from './service/mockService.js';
import type { ServiceConnection } from './service/connection.js';
import { ensureServiceCurrent, ensureServiceInstalled } from './service/installer.js';
import { initUpdater } from './updater.js';
import { initSmartFiltering } from './smartFiltering.js';
import { createTray } from './tray.js';
import { createWindow, handleDeepLink, showMainWindow } from './window.js';

const CONNECT_TIMEOUT_MS = 2000;
const features = productFeaturesForEnvironment(config.appEnv);

// Required for reliable native toast attribution on Windows (and harmless elsewhere).
app.setAppUserModelId('com.talysman.app');

// Registered as early as possible so nothing after this point can die silently. An
// uncaughtException leaves the process in an undefined state (Node's own guidance), so this
// reports it and exits rather than trying to keep running; an unhandledRejection is generally
// recoverable (a floating promise), so this only reports it and lets the app keep going —
// upgrading Node's default silent-warning behavior into something we actually see.
process.on('uncaughtException', (error) => {
  logger.error('[main] uncaughtException', error);
  track('main_process_error', { message: error.message, stack: error.stack?.slice(0, 4000), fatal: true });
  void shutdownFlush().finally(() => process.exit(1));
});
process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logger.error('[main] unhandledRejection', error);
  track('main_process_error', { message: error.message, stack: error.stack?.slice(0, 4000), fatal: false });
  void flushEvents();
});

async function connectService(): Promise<{ service: ServiceConnection; mock?: MockServiceConnection }> {
  if (config.useMockService) {
    logger.warn('[main] using explicitly requested in-process mock service');
    const mock = new MockServiceConnection();
    await mock.connect();
    return { service: mock, mock };
  }

  const pipe = new PipeServiceConnection(config.pipePath);
  const connected = await Promise.race([
    pipe.connect().then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), CONNECT_TIMEOUT_MS)),
  ]);

  if (connected && pipe.connected) {
    try {
      await pipe.request('ping', undefined);
    } catch (error) {
      pipe.close();
      throw error;
    }
    logger.info('[main] using real privileged service over named pipe');
    return { service: pipe };
  }

  pipe.close();
  throw new Error(
    `Privileged service is not reachable at ${config.pipePath}. Start/install Talysman, or use pnpm dev:mock for UI-only development.`,
  );
}

/**
 * A stale service (e.g. a LaunchDaemon/systemd unit that outlived several app updates without
 * restarting) fails the protocol check below. ensureServiceCurrent's repair -- reinstall +
 * restart -- is exactly what fixes that, so it must run, and be given the chance to succeed,
 * before the protocol version is treated as fatal. Previously the protocol check lived inside
 * connectService() and threw before ensureServiceCurrent ever ran, so a stale service just
 * killed the app on every launch instead of self-healing.
 */
async function ensureProtocolCompatible(service: ServiceConnection, mock: MockServiceConnection | undefined): Promise<void> {
  if (!mock) {
    await ensureServiceCurrent(service);
    const ping = await service.request('ping', undefined);
    if (ping.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(
        `Talysman service protocol ${ping.protocolVersion} is incompatible with desktop protocol ${PROTOCOL_VERSION}.`,
      );
    }
  }
  await service.request('setSmartFilteringEnabled', { enabled: features.smartFiltering });
}

function registerDeepLink(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [process.argv[1]!]);
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  }
}

async function bootstrap(): Promise<void> {
  await trackAppInstalledIfFirstRun();
  // Attempt delivery now, before connectService() — the service is exactly the step most
  // likely to fail on a first real install, and initAnalytics()'s flush never runs if it does.
  void flushEvents();
  registerDeepLink();
  await ensureServiceInstalled();

  const { service, mock } = await connectService();
  await ensureProtocolCompatible(service, mock);
  await registerIpcHandlers({ service, mock });
  initAnalytics(service);
  if (features.smartFiltering) initSmartFiltering(service);

  createWindow();
  recordAppOpen();
  // Linux has its own standalone tray helper (see file header); avoid a duplicate icon there.
  if (process.platform !== 'linux') createTray(service, mock);
  initUpdater(service);

  // Cold start launched via a deep link (e.g. Windows protocol activation): the URL arrives
  // in argv rather than via the second-instance / open-url events.
  const initialDeepLink = process.argv.find((a) => a.startsWith(`${DEEP_LINK_SCHEME}://`));
  if (initialDeepLink) void handleDeepLink(initialDeepLink);
}

// --- single instance ---
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const deepLink = argv.find((a) => a.startsWith(`${DEEP_LINK_SCHEME}://`));
    if (deepLink) void handleDeepLink(deepLink);
    else showMainWindow();
  });

  // macOS deep link (harmless on Windows).
  app.on('open-url', (_e, url) => {
    void handleDeepLink(url);
  });

  app.whenReady().then(bootstrap).catch(async (e) => {
    logger.error('[main] bootstrap failed', e);
    const error = e instanceof Error ? e : new Error(String(e));
    track('bootstrap_failed', { message: error.message, stack: error.stack?.slice(0, 4000) });
    // Bounded best-effort flush so this event (and any app_installed/service_install_failed
    // queued earlier) still gets a delivery attempt even though bootstrap never reached
    // initAnalytics().
    await shutdownFlush();
    app.quit();
  });

  app.on('window-all-closed', () => {
    // Enforcement lives in the privileged daemon; keeping Chromium alive after its last window
    // closes only burns resources and is not required for blocking or schedules. On Linux the
    // standalone `talysman-tray` helper is what keeps a status indicator alive after this quits.
    app.quit();
  });

  // Best-effort, time-boxed flush of queued analytics before the process actually exits.
  let quitFlushed = false;
  app.on('before-quit', (e) => {
    if (quitFlushed) return;
    e.preventDefault();
    quitFlushed = true;
    void shutdownFlush().finally(() => app.quit());
  });

  app.on('activate', () => {
    showMainWindow();
  });
}
