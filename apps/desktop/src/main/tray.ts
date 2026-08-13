/**
 * System tray for Windows/macOS. The icon mirrors whether blocking is active (green = focus on,
 * gray = focus off), and honors `settings.trayIconEnabled`. Linux doesn't use this — the
 * standalone `talysman-tray` helper (native/linux/src/bin/tray.rs) owns the tray icon there,
 * talking to the daemon directly so it keeps working (and stays cheap) whether or not this
 * Electron app is running. In dev (mock) the menu offers a toggle so you can flip the simulated
 * key.
 */

import { join } from 'node:path';
import { Menu, Tray, nativeImage } from 'electron';
import { config } from './config.js';
import { logger } from './logging.js';
import type { ServiceConnection } from './service/connection.js';
import type { MockServiceConnection } from './service/mockService.js';
import { showMainWindow } from './window.js';

let tray: Tray | null = null;

function iconFor(active: boolean): Electron.NativeImage {
  const file = active ? 'tray-green.png' : 'tray-gray.png';
  const img = nativeImage.createFromPath(join(process.resourcesPath ?? __dirname, file));
  // Fall back to an empty image if the asset is missing so the app still runs in dev.
  return img.isEmpty()
    ? nativeImage.createFromPath(join(__dirname, '../../resources', file))
    : img;
}

export function createTray(service: ServiceConnection, mock?: MockServiceConnection): void {
  let keyPresent = false;
  let blockingActive = false;

  const rebuildMenu = () => {
    if (!tray) return;
    const items: Electron.MenuItemConstructorOptions[] = [
      { label: blockingActive ? 'Blocking active ✅' : 'Blocking disabled', enabled: false },
      { label: keyPresent ? 'Key present' : 'No key', enabled: false },
      { type: 'separator' },
      { label: 'Open Talysman', click: () => showMainWindow() },
    ];
    if (mock) {
      items.push({
        label: 'Dev: toggle simulated USB key',
        click: () => mock.devToggleKey(),
      });
    }
    items.push({ type: 'separator' }, { role: 'quit' });
    tray.setContextMenu(Menu.buildFromTemplate(items));
  };

  const applyEnabled = (enabled: boolean) => {
    if (enabled && !tray) {
      tray = new Tray(iconFor(blockingActive));
      tray.setToolTip('Talysman');
      tray.on('click', () => showMainWindow());
      rebuildMenu();
    } else if (!enabled && tray) {
      tray.destroy();
      tray = null;
    }
  };

  const applyBlocking = (active: boolean) => {
    logger.debug(`[tray] blocking active → ${active}`);
    blockingActive = active;
    tray?.setImage(iconFor(active));
    rebuildMenu();
  };

  service.on('stateChanged', ({ state }) => {
    keyPresent = state.keyPresent;
    applyEnabled(state.settings.trayIconEnabled);
    applyBlocking(state.focusActive);
  });
  service.on('keyPresenceChanged', ({ present }) => {
    keyPresent = present;
    rebuildMenu();
  });
  service.on('focusChanged', ({ active }) => applyBlocking(active));
  service.on('settingsChanged', ({ settings }) => applyEnabled(settings.trayIconEnabled));
  void service
    .request('getState', undefined)
    .then((state) => {
      keyPresent = state.keyPresent;
      applyEnabled(state.settings.trayIconEnabled);
      applyBlocking(state.focusActive);
    })
    .catch((error: Error) => logger.warn(`[tray] initial state fetch failed: ${error.message}`));

  if (mock && config.isDev) logger.debug('[tray] dev mode: simulated-key toggle available');
}
