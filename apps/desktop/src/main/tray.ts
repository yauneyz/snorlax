/**
 * System tray. The icon mirrors whether blocking is active (green = focus on, gray = focus off)
 * by subscribing to focusChanged. In dev (mock) the menu offers a toggle so you can flip the
 * simulated key.
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

export function createTray(service: ServiceConnection, mock?: MockServiceConnection): Tray {
  tray = new Tray(iconFor(false));
  tray.setToolTip('Talysman');

  let keyPresent = false;
  let blockingActive = false;

  const rebuildMenu = () => {
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
    tray!.setContextMenu(Menu.buildFromTemplate(items));
  };

  const applyBlocking = (active: boolean) => {
    logger.debug(`[tray] blocking active → ${active}`);
    blockingActive = active;
    tray?.setImage(iconFor(active));
    rebuildMenu();
  };

  rebuildMenu();

  service.on('stateChanged', ({ state }) => {
    keyPresent = state.keyPresent;
    applyBlocking(state.focusActive);
  });
  service.on('keyPresenceChanged', ({ present }) => {
    keyPresent = present;
    rebuildMenu();
  });
  service.on('focusChanged', ({ active }) => applyBlocking(active));
  void service
    .request('getState', undefined)
    .then((state) => {
      keyPresent = state.keyPresent;
      applyBlocking(state.focusActive);
    })
    .catch((error: Error) => logger.warn(`[tray] initial state fetch failed: ${error.message}`));

  tray.on('click', () => showMainWindow());

  if (mock && config.isDev) logger.debug('[tray] dev mode: simulated-key toggle available');
  return tray;
}
