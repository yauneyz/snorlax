/**
 * Creates the main BrowserWindow with secure defaults (contextIsolation on, nodeIntegration
 * off, sandboxed renderer) and handles the focuslock:// deep link (billing return in Phase 3,
 * tray re-focus now).
 */

import { join } from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import { config } from './config.js';
import { logger } from './logging.js';

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
      preload: join(__dirname, '../preload/index.js'),
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

/** Handle a focuslock:// deep link (focus the window; billing return handled in Phase 3). */
export function handleDeepLink(url: string): void {
  logger.info(`[deeplink] ${url}`);
  showMainWindow();
}
