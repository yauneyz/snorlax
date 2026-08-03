/** Guarded electron-updater integration for packaged production builds. */

import { app, dialog, Notification } from 'electron';
import electronUpdater, { type AppUpdater, type UpdateDownloadedEvent } from 'electron-updater';
import { logger } from './logging.js';
import type { ServiceConnection } from './service/connection.js';
import { canRestartForUpdate } from './updaterPolicy.js';

const STARTUP_CHECK_DELAY_MS = 30_000;

export type AppUpdateCheckResult =
  | { status: 'up-to-date'; version: string }
  | { status: 'update-available'; version: string }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string };

let runManualCheck: () => Promise<AppUpdateCheckResult> = async () => ({
  status: 'unavailable',
  message: 'The updater is still starting. Try again in a moment.',
});

/** Run a user-requested update check. */
export function checkForAppUpdates(): Promise<AppUpdateCheckResult> {
  return runManualCheck();
}

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
    runManualCheck = async () => ({
      status: 'unavailable',
      message: 'Update checks are only available in an installed app.',
    });
    return () => undefined;
  }
  if (process.platform === 'linux') {
    logger.info('[updater] Linux updates are managed by the signed APT/Nix package source');
    runManualCheck = async () => ({
      status: 'unavailable',
      message: 'Updates on Linux are managed by your package manager.',
    });
    return () => undefined;
  }

  const autoUpdater = updaterInstance();
  autoUpdater.logger = logger;
  autoUpdater.autoDownload = false;
  // Talysman must decide when its privileged service may restart; never install merely because
  // the tray application happened to quit.
  autoUpdater.autoInstallOnAppQuit = false;

  let downloaded: UpdateDownloadedEvent | null = null;
  let promptOpen = false;
  let activeCheck: Promise<AppUpdateCheckResult> | null = null;
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

  const check = (manual = false): Promise<AppUpdateCheckResult> => {
    if (activeCheck) return activeCheck;

    const nextCheck = (async (): Promise<AppUpdateCheckResult> => {
      userDeferred = false;
      try {
        logger.info('[updater] checking for updates');
        const result = await autoUpdater.checkForUpdates();
        await maybeOfferInstall();

        if (!result) {
          return {
            status: 'error',
            message: 'The updater is unavailable right now.',
          };
        }
        if (result.isUpdateAvailable) {
          if (manual && !downloaded) {
            const { response } = await dialog.showMessageBox({
              type: 'info',
              title: 'Talysman update available',
              message: `Talysman ${result.updateInfo.version} is available.`,
              detail: 'Download it now? Installation will still wait until enforcement can restart safely.',
              buttons: ['Download', 'Later'],
              defaultId: 0,
              cancelId: 1,
              noLink: true,
            });
            if (response === 0) await autoUpdater.downloadUpdate();
          }
          return { status: 'update-available', version: result.updateInfo.version };
        }
        return { status: 'up-to-date', version: app.getVersion() };
      } catch (error) {
        logger.warn('[updater] update check failed', error);
        return {
          status: 'error',
          message: error instanceof Error ? error.message : 'Unable to check for updates.',
        };
      }
    })().finally(() => {
      activeCheck = null;
    });
    activeCheck = nextCheck;

    return nextCheck;
  };

  runManualCheck = () => check(true);

  autoUpdater.on('update-available', (info) => {
    logger.info(`[updater] update available: ${info.version}`);
  });
  autoUpdater.on('update-not-available', (info) => {
    logger.info(`[updater] current version is up to date (${info.version})`);
  });
  let lastLoggedDownloadBucket = -1;
  autoUpdater.on('download-progress', (progress) => {
    const bucket = Math.floor(progress.percent / 10);
    if (bucket !== lastLoggedDownloadBucket) {
      lastLoggedDownloadBucket = bucket;
      logger.info(`[updater] download ${Math.min(bucket * 10, 100)}%`);
    }
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

  const startupTimer = setTimeout(() => void check(false), STARTUP_CHECK_DELAY_MS);
  startupTimer.unref();

  return () => {
    clearTimeout(startupTimer);
    unsubscribeFocus();
    unsubscribeKey();
  };
}
