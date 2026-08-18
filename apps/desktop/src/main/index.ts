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
import { initAnalytics, recordAppOpen, shutdownFlush, trackAppInstalledIfFirstRun } from './analytics.js';
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
    let ping: { version: string; protocolVersion: number };
    try {
      ping = await pipe.request('ping', undefined);
    } catch (error) {
      pipe.close();
      throw error;
    }
    if (ping.protocolVersion !== PROTOCOL_VERSION) {
      pipe.close();
      throw new Error(
        `Talysman service protocol ${ping.protocolVersion} is incompatible with desktop protocol ${PROTOCOL_VERSION}.`,
      );
    }
    logger.info('[main] using real privileged service over named pipe');
    return { service: pipe };
  }

  pipe.close();
  throw new Error(
    `Privileged service is not reachable at ${config.pipePath}. Start/install Talysman, or use pnpm dev:mock for UI-only development.`,
  );
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
  registerDeepLink();
  await ensureServiceInstalled();

  const { service, mock } = await connectService();
  await registerIpcHandlers({ service, mock });
  initAnalytics(service);
  if (features.smartFiltering) initSmartFiltering(service);

  createWindow();
  recordAppOpen();
  // Linux has its own standalone tray helper (see file header); avoid a duplicate icon there.
  if (process.platform !== 'linux') createTray(service, mock);
  if (!mock) await ensureServiceCurrent(service);
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

  app.whenReady().then(bootstrap).catch((e) => {
    logger.error('[main] bootstrap failed', e);
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
