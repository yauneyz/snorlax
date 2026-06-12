/**
 * System tray. The icon mirrors the service's USB key presence (green = key present, red =
 * absent) by subscribing to keyPresenceChanged. In dev (mock) the menu offers a toggle so you
 * can flip the simulated key.
 */

import { join } from 'node:path';
import { Menu, Tray, nativeImage } from 'electron';
import { config } from './config.js';
import { logger } from './logging.js';
import type { ServiceConnection } from './service/connection.js';
import type { MockServiceConnection } from './service/mockService.js';
import { getMainWindow } from './window.js';

let tray: Tray | null = null;

function iconFor(present: boolean): Electron.NativeImage {
  const file = present ? 'tray-green.png' : 'tray-red.png';
  const img = nativeImage.createFromPath(join(process.resourcesPath ?? __dirname, file));
  // Fall back to an empty image if the asset is missing so the app still runs in dev.
  return img.isEmpty()
    ? nativeImage.createFromPath(join(__dirname, '../../resources', file))
    : img;
}

export function createTray(service: ServiceConnection, mock?: MockServiceConnection): Tray {
  tray = new Tray(iconFor(false));
  tray.setToolTip('FocusLock');

  const rebuildMenu = (present: boolean) => {
    const items: Electron.MenuItemConstructorOptions[] = [
      { label: present ? 'Key present ✅' : 'No key ❌', enabled: false },
      { type: 'separator' },
      { label: 'Open FocusLock', click: () => getMainWindow()?.show() },
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

  rebuildMenu(false);

  service.on('keyPresenceChanged', ({ present }) => {
    logger.debug(`[tray] key presence → ${present}`);
    tray?.setImage(iconFor(present));
    rebuildMenu(present);
  });

  tray.on('click', () => getMainWindow()?.show());

  if (config.isDev) logger.debug('[tray] dev mode: simulated-key toggle available');
  return tray;
}
