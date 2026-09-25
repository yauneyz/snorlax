/**
 * The user's "AI mode" setting. Off by default: with it off, the AI judge is completely out of
 * the picture — its controls are hidden and the daemon's `smartFilteringEnabled` capability flag
 * is off, so every `judge` rule resolves to its fallback (see natmsg `Blocking::resolve`) and no
 * page content is ever extracted or sent anywhere. AI rules already in a profile are kept, just
 * inert, and come back when AI mode is turned on again.
 *
 * Deliberately client-side, like onboarding.ts: it's a preference, not a security boundary. The
 * judge already degrades to its fallback whenever Electron can't answer (signed out, app quit),
 * so turning AI mode off grants nothing that quitting the app wouldn't.
 */

import { app } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { productFeaturesForEnvironment } from '@talysman/product';
import { config } from './config.js';
import { logger } from './logging.js';
import type { ServiceConnection } from './service/connection.js';
import { effectiveSmartFiltering, resolveAiModeEnabled } from './aiModePolicy.js';

const STORE_FILE = 'ai-mode.json';

const features = productFeaturesForEnvironment(config.appEnv);

let cache: boolean | undefined;

async function pathFor(): Promise<string> {
  const dir = app.getPath('userData');
  await mkdir(dir, { recursive: true });
  return join(dir, STORE_FILE);
}

async function readStored(): Promise<boolean | undefined> {
  try {
    const parsed = JSON.parse(await readFile(await pathFor(), 'utf8')) as { enabled?: unknown };
    return typeof parsed.enabled === 'boolean' ? parsed.enabled : undefined;
  } catch {
    // Missing or unreadable: no choice made yet.
    return undefined;
  }
}

async function persist(enabled: boolean): Promise<void> {
  try {
    await writeFile(await pathFor(), JSON.stringify({ enabled }), { mode: 0o600 });
  } catch (error) {
    logger.warn('[aiMode] could not persist setting', error);
  }
}

/** The current AI mode choice; the first call settles the default (see `resolveAiModeEnabled`). */
export async function getAiModeEnabled(service: ServiceConnection): Promise<boolean> {
  if (cache !== undefined) return cache;
  const stored = await readStored();
  if (stored !== undefined) {
    cache = stored;
    return cache;
  }
  const { engine } = await service.request('getState', undefined);
  cache = resolveAiModeEnabled(undefined, engine.profiles.map((status) => status.profile));
  // Pin the default so it doesn't flip later when the user's rules change.
  await persist(cache);
  return cache;
}

/** Push the effective capability flag (build flag AND AI mode) to the daemon. */
export async function applyAiMode(service: ServiceConnection): Promise<void> {
  const enabled = effectiveSmartFiltering(features.smartFiltering, await getAiModeEnabled(service));
  await service.request('setSmartFilteringEnabled', { enabled });
}

export async function setAiModeEnabled(service: ServiceConnection, enabled: boolean): Promise<void> {
  cache = enabled;
  await persist(enabled);
  await applyAiMode(service);
}

/** Synchronous read for hot paths once startup has settled the value. Unknown ⇒ off. */
export function aiModeEnabledSync(): boolean {
  return cache === true;
}
