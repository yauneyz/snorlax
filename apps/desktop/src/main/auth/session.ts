/**
 * Session persistence for the main-process Supabase client (architecture §10).
 *
 * supabase-js owns the access/refresh tokens; we just give it a storage adapter so the
 * session (and the transient PKCE code-verifier) survive restarts. The blob is encrypted
 * at rest with Electron `safeStorage` (DPAPI on Windows / Keychain on macOS). Tokens never
 * leave the main process — the renderer only ever sees `{ signedIn, email }`.
 */

import { app, safeStorage } from 'electron';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../logging.js';

const STORE_FILE = 'supabase-auth.bin';

let storePath: string | undefined;
let cache: Record<string, string> | undefined;
let loadPromise: Promise<Record<string, string>> | undefined;

async function pathFor(): Promise<string> {
  if (!storePath) {
    const dir = app.getPath('userData');
    await mkdir(dir, { recursive: true });
    storePath = join(dir, STORE_FILE);
  }
  return storePath;
}

function decode(raw: Buffer): Record<string, string> {
  const text = safeStorage.isEncryptionAvailable()
    ? safeStorage.decryptString(raw)
    : raw.toString('utf8');
  return JSON.parse(text) as Record<string, string>;
}

async function load(): Promise<Record<string, string>> {
  if (cache) return cache;
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const raw = await readFile(await pathFor());
        cache = decode(raw);
      } catch {
        cache = {};
      }
      return cache;
    })();
  }
  return loadPromise;
}

async function persist(map: Record<string, string>): Promise<void> {
  const text = JSON.stringify(map);
  const buf = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(text)
    : Buffer.from(text, 'utf8');
  await writeFile(await pathFor(), buf, { mode: 0o600 });
  if (!safeStorage.isEncryptionAvailable()) {
    logger.warn('[auth] OS encryption unavailable — Supabase session stored unencrypted');
  }
}

/**
 * Storage adapter passed to `createClient(..., { auth: { storage } })`. supabase-js keys
 * include the session token and, during sign-in, the PKCE code verifier.
 */
export const supabaseAuthStorage = {
  getItem: async (key: string): Promise<string | null> => {
    const map = await load();
    return map[key] ?? null;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    const map = await load();
    map[key] = value;
    await persist(map);
  },
  removeItem: async (key: string): Promise<void> => {
    const map = await load();
    delete map[key];
    await persist(map);
  },
};

/** Wipe all persisted auth state (used on sign-out failures / resets). */
export async function clearSession(): Promise<void> {
  cache = {};
  loadPromise = Promise.resolve({});
  try {
    await rm(await pathFor(), { force: true });
  } catch {
    /* already gone */
  }
}
