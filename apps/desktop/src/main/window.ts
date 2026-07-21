/**
 * Creates the main BrowserWindow with secure defaults (contextIsolation on, nodeIntegration
 * off, sandboxed renderer) and handles the talysman:// deep link: the Supabase OAuth return
 * (auth/callback) and the Stripe checkout return (billing/success|cancel).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import {
  DESKTOP_AUTH_CALLBACK_PATH,
  DESKTOP_AUTH_RESET_CALLBACK_PATH,
  DESKTOP_BILLING_SUCCESS_PATH,
} from '@talysman/auth-contracts';
import { config } from './config.js';
import { logger } from './logging.js';
import { completeOAuth, reportAuthFlowError } from './auth/supabase.js';
import { applyPlanLimitsNow, broadcastAppEvent } from './ipc/handlers.js';
import { parseDeepLink } from './deepLink.js';

let mainWindow: BrowserWindow | null = null;

/**
 * Window icon for Linux and Windows, which read it off the window rather than the bundle (macOS
 * uses the .icns baked in by electron-builder). Packaged builds get it from extraResources; dev
 * falls back to the repo copy.
 */
function windowIcon(): string {
  const packaged = join(process.resourcesPath ?? __dirname, 'icon.png');
  return existsSync(packaged) ? packaged : join(__dirname, '../../resources/icon.png');
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    show: false,
    backgroundColor: '#08090a',
    title: 'Talysman',
    icon: windowIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.on('ready-to-show', () => win.show());

  // Open target=_blank / external links in the system browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // electron-vite serves the renderer from a dev URL in dev, and from a file in prod.
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (config.isDev && devUrl) {
    void win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow = win;
  win.on('closed', () => {
    mainWindow = null;
  });
  return win;
}

function presentWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Show the existing main window, or recreate it after the user closed it to the tray. */
export function showMainWindow(): BrowserWindow | null {
  if (!app.isReady()) {
    void app.whenReady().then(() => showMainWindow());
    return mainWindow;
  }

  const existingWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const win = existingWindow ?? createWindow();
  if (existingWindow) {
    presentWindow(win);
  } else {
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) presentWindow(win);
    });
  }
  return win;
}

/**
 * Handle a talysman:// deep link:
 *  - auth/callback?code=…       → finish the Supabase OAuth/confirmation exchange.
 *  - auth/reset-callback?code=… → establish a password-recovery session; the renderer sees
 *                                 `passwordRecovery` via authStatus and shows the reset form.
 *  - billing/success            → refresh entitlement (the webhook is the authoritative sync).
 *  - billing/cancel             → just refocus the window.
 */
export async function handleDeepLink(url: string): Promise<void> {
  try {
    const parsed = parseDeepLink(url);
    // Never log the query string: authentication deep links contain a short-lived code.
    logger.info(`[deeplink] ${parsed.logLabel}`);

    if (
      parsed.path === DESKTOP_AUTH_CALLBACK_PATH ||
      parsed.path === DESKTOP_AUTH_RESET_CALLBACK_PATH
    ) {
      const oauthError = parsed.error;
      const code = parsed.code;
      if (oauthError) {
        reportAuthFlowError(
          oauthError === 'access_denied'
            ? 'Google sign-in was cancelled.'
            : 'Google sign-in could not be completed. Please try again.',
        );
      } else if (code) {
        await completeOAuth(code, {
          recovery: parsed.path === DESKTOP_AUTH_RESET_CALLBACK_PATH,
        });
        await applyPlanLimitsNow();
        broadcastAppEvent('authChanged');
      } else {
        reportAuthFlowError('Google sign-in returned without an authorization code.');
      }
    } else if (parsed.path === DESKTOP_BILLING_SUCCESS_PATH) {
      await applyPlanLimitsNow();
      broadcastAppEvent('entitlementChanged');
    }
  } catch (e) {
    logger.error('[deeplink] failed to handle', (e as Error).message);
    reportAuthFlowError((e as Error).message);
  }

  showMainWindow();
}
