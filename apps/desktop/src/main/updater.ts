/** Guarded electron-updater integration for packaged production builds. */

import { app, dialog, Notification } from 'electron';
import electronUpdater, { type AppUpdater, type UpdateDownloadedEvent } from 'electron-updater';
import { logger } from './logging.js';
import type { ServiceConnection } from './service/connection.js';
import { canRestartForUpdate } from './updaterPolicy.js';

const STARTUP_CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

function updaterInstance(): AppUpdater {
  // electron-updater is CommonJS; default import + destructuring is its documented ESM bridge.
  return electronUpdater.autoUpdater;
}

async function enforcementAllowsRestart(service: ServiceConnection): Promise<boolean> {
  try {
    const state = await service.request('getState', undefined);
    return canRestartForUpdate(state);
  } catch (error) {
    logger.warn('[updater] cannot verify enforcement state; deferring update installation', error);
    return false;
  }
}

function notifyDeferredUpdate(version: string): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: `Talysman ${version} is ready`,
    body: 'The update will wait until Focus is off or your paired key is present.',
    silent: true,
  });
  notification.show();
}

export function initUpdater(service: ServiceConnection): () => void {
  if (!app.isPackaged) {
    logger.debug('[updater] skipped for unpackaged development build');
    return () => undefined;
  }
  if (process.platform === 'linux') {
    logger.info('[updater] Linux updates are managed by the signed APT/Nix package source');
    return () => undefined;
  }

  const autoUpdater = updaterInstance();
  autoUpdater.logger = logger;
  autoUpdater.autoDownload = true;
  // Talysman must decide when its privileged service may restart; never install merely because
  // the tray application happened to quit.
  autoUpdater.autoInstallOnAppQuit = false;

  let downloaded: UpdateDownloadedEvent | null = null;
  let promptOpen = false;
  let checking = false;
  let userDeferred = false;
  let unsafeNotificationShown = false;

  const maybeOfferInstall = async (): Promise<void> => {
    if (!downloaded || promptOpen || userDeferred) return;
    if (!(await enforcementAllowsRestart(service))) {
      if (!unsafeNotificationShown) {
        unsafeNotificationShown = true;
        notifyDeferredUpdate(downloaded.version);
      }
      return;
    }

    promptOpen = true;
    const version = downloaded.version;
    try {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: 'Talysman update ready',
        message: `Talysman ${version} has been downloaded.`,
        detail:
          'Restart now to install it. The enforcement service may be unavailable briefly while it is upgraded and restarted.',
        buttons: ['Restart and update', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (response === 0) {
        logger.info(`[updater] installing ${version}`);
        autoUpdater.quitAndInstall(false, true);
        return;
      }
      userDeferred = true;
      logger.info(`[updater] user deferred ${version}`);
    } finally {
      promptOpen = false;
    }
  };

  const check = async (): Promise<void> => {
    if (checking) return;
    checking = true;
    userDeferred = false;
    try {
      logger.info('[updater] checking for updates');
      await autoUpdater.checkForUpdates();
      await maybeOfferInstall();
    } catch (error) {
      logger.warn('[updater] update check failed', error);
    } finally {
      checking = false;
    }
  };

  autoUpdater.on('update-available', (info) => {
    logger.info(`[updater] update available: ${info.version}`);
  });
  autoUpdater.on('update-not-available', (info) => {
    logger.info(`[updater] current version is up to date (${info.version})`);
  });
  autoUpdater.on('download-progress', (progress) => {
    logger.info(`[updater] download ${progress.percent.toFixed(1)}%`);
  });
  autoUpdater.on('update-downloaded', (event) => {
    downloaded = event;
    unsafeNotificationShown = false;
    logger.info(`[updater] update downloaded: ${event.version}`);
    void maybeOfferInstall();
  });
  autoUpdater.on('error', (error) => {
    logger.error('[updater] error', error);
  });

  // A downloaded update that was blocked by active enforcement becomes eligible as soon as focus
  // ends or the paired key appears.
  const unsubscribeFocus = service.on('focusChanged', () => void maybeOfferInstall());
  const unsubscribeKey = service.on('keyPresenceChanged', () => void maybeOfferInstall());

  const startupTimer = setTimeout(() => void check(), STARTUP_CHECK_DELAY_MS);
  startupTimer.unref();
  const interval = setInterval(() => void check(), CHECK_INTERVAL_MS);
  interval.unref();

  return () => {
    clearTimeout(startupTimer);
    clearInterval(interval);
    unsubscribeFocus();
    unsubscribeKey();
  };
}
