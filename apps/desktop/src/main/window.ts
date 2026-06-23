/**
 * Creates the main BrowserWindow with secure defaults (contextIsolation on, nodeIntegration
 * off, sandboxed renderer) and handles the focuslock:// deep link: the Supabase OAuth return
 * (auth/callback) and the Stripe checkout return (billing/success|cancel).
 */

import { join } from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import {
  DESKTOP_AUTH_CALLBACK_PATH,
  DESKTOP_BILLING_SUCCESS_PATH,
} from '@focuslock/auth-contracts';
import { config } from './config.js';
import { logger } from './logging.js';
import { completeOAuth } from './auth/supabase.js';
import { applyPlanLimitsNow, broadcastAppEvent } from './ipc/handlers.js';

let mainWindow: BrowserWindow | null = null;

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
    backgroundColor: '#0b0f17',
    title: 'FocusLock',
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
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // electron-vite serves the renderer from a dev URL in dev, and from a file in prod.
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (config.isDev && devUrl) {
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
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
 * Handle a focuslock:// deep link:
 *  - auth/callback?code=… → finish the Supabase OAuth exchange, then refresh entitlement.
 *  - billing/success      → refresh entitlement (the webhook is the authoritative sync).
 *  - billing/cancel       → just refocus the window.
 */
export async function handleDeepLink(url: string): Promise<void> {
  logger.info(`[deeplink] ${url}`);
  try {
    const parsed = new URL(url);
    const path = `${parsed.host}${parsed.pathname}`.replace(/\/$/, '');

    if (path === DESKTOP_AUTH_CALLBACK_PATH) {
      const code = parsed.searchParams.get('code');
      if (code) {
        await completeOAuth(code);
        await applyPlanLimitsNow();
        broadcastAppEvent('authChanged');
      }
    } else if (path === DESKTOP_BILLING_SUCCESS_PATH) {
      await applyPlanLimitsNow();
      broadcastAppEvent('entitlementChanged');
    }
  } catch (e) {
    logger.error('[deeplink] failed to handle', (e as Error).message);
  }

  showMainWindow();
}
