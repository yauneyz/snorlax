/**
 * The block/unlock popup (spec §3.10) for desktop apps: when the service closes a blocked app it
 * emits `appBlocked`, and this opens a small always-on-top window rendering the same popup the
 * extension's blocked page shows — blocking profiles, streak, the app's pool with its pause and
 * unlocks left, and a way into the key-gated override options in the main window.
 *
 * One popup at a time; a second `appBlocked` for the same app just refocuses it.
 */

import { join } from 'node:path';
import { BrowserWindow, screen } from 'electron';
import type { AppRef } from '@talysman/shared';
import { palette } from '@talysman/shared';
import { config } from './config.js';

let popup: BrowserWindow | null = null;
let popupKey: string | null = null;

const WIDTH = 380;
const HEIGHT = 520;

export function showUnlockPopup(app: AppRef): void {
  const key = JSON.stringify(app);
  if (popup && !popup.isDestroyed()) {
    if (popupKey === key) {
      popup.show();
      popup.focus();
      return;
    }
    popup.close();
  }

  const { workArea } = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
    y: Math.round(workArea.y + (workArea.height - HEIGHT) / 3),
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: palette.colors.background,
    title: 'Talysman',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (popup === win) {
      popup = null;
      popupKey = null;
    }
  });

  // The renderer reads the target from the query string and renders only the popup.
  const query = { popup: 'app', app: key };
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (config.isDev && devUrl) {
    const url = new URL(devUrl);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    void win.loadURL(url.toString());
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query });
  }
  popup = win;
  popupKey = key;
}

/** Close the popup (the user dismissed it or unlocked). */
export function closeUnlockPopup(): void {
  if (popup && !popup.isDestroyed()) popup.close();
}
