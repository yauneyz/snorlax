/** Guarded electron-updater integration for packaged production builds. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, dialog } from 'electron';
import electronUpdater, { type AppUpdater, type UpdateDownloadedEvent } from 'electron-updater';
import { logger } from './logging.js';

const STARTUP_CHECK_DELAY_MS = 30_000;
/** Long-running installs (tray apps rarely restart) still pick up releases between launches. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

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

/**
 * rpm and pacman installs have no package repository behind them, so electron-updater keeps them
 * current from latest-linux.yml (installing through pkexec + dnf/zypper/pacman). electron-builder
 * writes `resources/package-type` into every fpm package; deb reads "deb" and stays on the signed
 * APT repository, and the NixOS AppImage has no such file at all.
 */
function selfUpdatingLinuxPackage(): boolean {
  try {
    const type = readFileSync(join(process.resourcesPath, 'package-type'), 'utf8').trim();
    return type === 'rpm' || type === 'pacman';
  } catch {
    return false;
  }
}

function updaterInstance(): AppUpdater {
  // electron-updater is CommonJS; default import + destructuring is its documented ESM bridge.
  return electronUpdater.autoUpdater;
}

export function initUpdater(): () => void {
  if (!app.isPackaged) {
    logger.debug('[updater] skipped for unpackaged development build');
    runManualCheck = async () => ({
      status: 'unavailable',
      message: 'Update checks are only available in an installed app.',
    });
    return () => undefined;
  }
  if (process.platform === 'linux' && !selfUpdatingLinuxPackage()) {
    logger.info('[updater] Linux updates are managed by the signed APT/Nix package source');
    runManualCheck = async () => ({
      status: 'unavailable',
      message: 'Updates on Linux are managed by your package manager.',
    });
    return () => undefined;
  }

  const autoUpdater = updaterInstance();
  autoUpdater.logger = logger;
  // Download in the background as soon as a check finds an update, so the startup check ends in
  // the "Restart and update" prompt below. With this off, only a manual "Check for updates"
  // ever downloaded anything, and installs sat on old versions indefinitely (a Windows 0.8.0
  // install was still reporting an error fixed in 0.8.1 a month after the fix shipped).
  autoUpdater.autoDownload = true;
  // Talysman must decide when its privileged service may restart; never install merely because
  // the tray application happened to quit.
  autoUpdater.autoInstallOnAppQuit = false;

  let downloaded: UpdateDownloadedEvent | null = null;
  let promptOpen = false;
  let activeCheck: Promise<AppUpdateCheckResult> | null = null;
  let userDeferred = false;

  const maybeOfferInstall = async (): Promise<void> => {
    if (!downloaded || promptOpen || userDeferred) return;
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

  const check = (): Promise<AppUpdateCheckResult> => {
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
          // autoDownload has already started the download; `update-downloaded` offers the install.
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

  runManualCheck = () => check();

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
    logger.info(`[updater] update downloaded: ${event.version}`);
    void maybeOfferInstall();
  });
  autoUpdater.on('error', (error) => {
    logger.error('[updater] error', error);
  });

  const startupTimer = setTimeout(() => void check(), STARTUP_CHECK_DELAY_MS);
  startupTimer.unref();
  const interval = setInterval(() => void check(), CHECK_INTERVAL_MS);
  interval.unref();

  return () => {
    clearTimeout(startupTimer);
    clearInterval(interval);
  };
}
