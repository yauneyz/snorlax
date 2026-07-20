/**
 * App entry: single-instance lock, talysman:// protocol registration, window + tray,
 * service connection (real pipe, or in-process mock when the pipe is unavailable / dev),
 * IPC handlers, and the (stubbed) updater.
 *
 * Service selection: we try the real named-pipe service first; if it isn't reachable (e.g.
 * running `pnpm dev` on a box without the installed service, or on WSL), we transparently
 * fall back to the in-process mock so the whole UI still works.
 */

import { app } from 'electron';
import { DEEP_LINK_SCHEME } from '@talysman/shared';
import { config } from './config.js';
import { logger } from './logging.js';
import { registerIpcHandlers } from './ipc/handlers.js';
import { PipeServiceConnection } from './service/client.js';
import { MockServiceConnection } from './service/mockService.js';
import type { ServiceConnection } from './service/connection.js';
import { ensureServiceInstalled } from './service/installer.js';
import { initUpdater } from './updater.js';
import { createTray } from './tray.js';
import { createWindow, handleDeepLink, showMainWindow } from './window.js';

const CONNECT_TIMEOUT_MS = 2000;

// Required for reliable native toast attribution on Windows (and harmless elsewhere).
app.setAppUserModelId('com.talysman.app');

async function connectService(): Promise<{ service: ServiceConnection; mock?: MockServiceConnection }> {
  const pipe = new PipeServiceConnection(config.pipePath);
  const connected = await Promise.race([
    pipe.connect().then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), CONNECT_TIMEOUT_MS)),
  ]);

  if (connected && pipe.connected) {
    logger.info('[main] using real privileged service over named pipe');
    return { service: pipe };
  }

  pipe.close();
  logger.warn('[main] privileged service not reachable — falling back to in-process mock');
  const mock = new MockServiceConnection();
  await mock.connect();
  return { service: mock, mock };
}

function registerDeepLink(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [process.argv[1]!]);
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  }
}

async function bootstrap(): Promise<void> {
  registerDeepLink();
  await ensureServiceInstalled();

  const { service, mock } = await connectService();
  await registerIpcHandlers({ service, mock });

  createWindow();
  createTray(service, mock);
  initUpdater();

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
    // Keep running in the tray on Windows/Linux; only quit on explicit Quit.
    if (process.platform === 'darwin') return;
  });

  app.on('activate', () => {
    showMainWindow();
  });
}
