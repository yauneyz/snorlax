/**
 * ipcMain handlers the preload calls into. They translate UI intents into service RPCs and
 * forward pushed service events to every renderer. Auth/payment intents are stubbed until
 * Phase 3.
 */

import { BrowserWindow, ipcMain, shell } from 'electron';
import type { EventName, Method, Params } from '@focuslock/shared';
import { config } from '../config.js';
import { logger } from '../logging.js';
import { isServiceError, type ServiceConnection } from '../service/connection.js';
import type { MockServiceConnection } from '../service/mockService.js';
import { Channels } from './channels.js';

const FORWARDED_EVENTS: EventName[] = [
  'keyPresenceChanged',
  'focusChanged',
  'policyChanged',
  'scheduleFired',
];

export interface HandlerContext {
  service: ServiceConnection;
  /** Present only when running against the in-process mock (dev/WSL). */
  mock?: MockServiceConnection;
}

export function registerIpcHandlers(ctx: HandlerContext): void {
  const { service, mock } = ctx;

  // Forward service events to all renderer windows.
  for (const event of FORWARDED_EVENTS) {
    service.on(event, (payload) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(Channels.serviceEvent, { event, payload });
      }
    });
  }

  ipcMain.handle(Channels.serviceRequest, async (_e, arg: { method: Method; params: unknown }) => {
    try {
      const result = await service.request(arg.method, arg.params as Params<Method>);
      return { ok: true, result };
    } catch (e) {
      if (isServiceError(e)) return { ok: false, code: e.code, message: e.message };
      logger.error('[ipc] unexpected service error', e);
      return { ok: false, code: 'INTERNAL', message: (e as Error).message };
    }
  });

  ipcMain.handle(Channels.appInfo, () => ({
    appEnv: config.appEnv,
    usingMock: Boolean(mock),
    serviceConnected: service.connected,
  }));

  ipcMain.handle(Channels.openExternal, async (_e, url: string) => {
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle(Channels.devToggleKey, () => {
    if (!mock) return { ok: false, message: 'Only available against the mock service.' };
    return { ok: true, present: mock.devToggleKey() };
  });
}
