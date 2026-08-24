/**
 * The desktop install's `device_id`, and the `userData` path helper everything analytics
 * persists through.
 *
 * Split out of `analytics.ts` so that modules which merely need to *read* the device id can
 * do so without importing the analytics module. `analytics.ts` imports `getAccessToken` from
 * `auth/supabase.ts`, so anything under `auth/` that reached back into `analytics.ts` — the
 * Google sign-in and billing flows both need the device id for the web<->desktop bridge —
 * would close an import cycle. This module depends on nothing but electron and node, so it
 * can be imported from either side.
 *
 * Same "losing it is safe" posture as `onboarding.ts`: worst case a reinstall looks like a
 * new device, which is the honest direction to be wrong in.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { logger } from './logging.js';

const DEVICE_ID_FILE = 'device-id.json';

export interface DeviceIdentity {
  deviceId: string;
  installedAt: string;
}

let deviceCache: DeviceIdentity | undefined;

export async function pathFor(file: string): Promise<string> {
  const dir = app.getPath('userData');
  await mkdir(dir, { recursive: true });
  return join(dir, file);
}

/** Reads the device identity, minting and persisting one on first run. */
export async function loadDeviceIdentity(): Promise<{ identity: DeviceIdentity }> {
  if (deviceCache) return { identity: deviceCache };

  try {
    const parsed = JSON.parse(await readFile(await pathFor(DEVICE_ID_FILE), 'utf8')) as Partial<DeviceIdentity>;
    if (typeof parsed.deviceId === 'string') {
      deviceCache = {
        deviceId: parsed.deviceId,
        installedAt: typeof parsed.installedAt === 'string' ? parsed.installedAt : new Date().toISOString(),
      };
      return { identity: deviceCache };
    }
  } catch {
    // Missing or unreadable: this is a first run.
  }

  const identity: DeviceIdentity = { deviceId: randomUUID(), installedAt: new Date().toISOString() };
  try {
    await writeFile(await pathFor(DEVICE_ID_FILE), JSON.stringify(identity), { mode: 0o600 });
  } catch (error) {
    logger.warn('[analytics] could not persist device id', error);
  }
  deviceCache = identity;
  return { identity };
}
