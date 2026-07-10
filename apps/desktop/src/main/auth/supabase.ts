/**
 * Supabase auth (architecture §10). The client lives in the MAIN process so access/refresh
 * tokens never reach the renderer's DOM — the renderer only learns `{ signedIn, email }`.
 *
 * Two sign-in paths are supported, matching the web app:
 *  - Google via the system browser (PKCE), returning through `talysman://auth/callback`.
 *  - email/password directly from an in-app form.
 *
 * supabase-js owns token refresh + persistence; we hand it the encrypted storage adapter
 * from session.ts.
 */

import { shell } from 'electron';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import {
  DESKTOP_AUTH_CALLBACK_PATH,
  desktopDeepLinkUrl,
  type AuthStatus,
} from '@talysman/auth-contracts';
import { config } from '../config.js';
import { logger } from '../logging.js';
import { clearSession, supabaseAuthStorage } from './session.js';

let client: SupabaseClient | undefined;
let authChangeListener: (() => void) | undefined;

export function isAuthConfigured(): boolean {
  return Boolean(config.supabaseUrl && config.supabaseAnonKey);
}

function getClient(): SupabaseClient {
  if (!isAuthConfigured()) {
    throw new Error(
      'Supabase is not configured (missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).',
    );
  }
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      // Electron 31 embeds Node 20, which does not expose a native WebSocket.
      // Supabase initializes its Realtime client eagerly, even when we only use Auth.
      realtime: { transport: WebSocket },
      auth: {
        flowType: 'pkce',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        storage: supabaseAuthStorage,
      },
    });
    client.auth.onAuthStateChange(() => authChangeListener?.());
  }
  return client;
}

/** Registered by the IPC layer to push auth/entitlement changes to renderers. */
export function setAuthChangeListener(cb: () => void): void {
  authChangeListener = cb;
}

export async function getAuthStatus(): Promise<AuthStatus> {
  if (!isAuthConfigured()) return { signedIn: false };
  const { data } = await getClient().auth.getSession();
  const user = data.session?.user;
  return user ? { signedIn: true, email: user.email ?? undefined } : { signedIn: false };
}

/** Current access token for `Authorization: Bearer` calls, or null when signed out. */
export async function getAccessToken(): Promise<string | null> {
  if (!isAuthConfigured()) return null;
  const { data } = await getClient().auth.getSession();
  return data.session?.access_token ?? null;
}

/** Open the system browser for Google OAuth; completes via the auth/callback deep link. */
export async function signInWithGoogle(): Promise<{ ok: boolean; message?: string }> {
  try {
    const { data, error } = await getClient().auth.signInWithOAuth({
      provider: 'google',
      options: {
        skipBrowserRedirect: true,
        redirectTo: desktopDeepLinkUrl(DESKTOP_AUTH_CALLBACK_PATH),
      },
    });
    if (error || !data?.url) {
      return { ok: false, message: error?.message ?? 'Could not start Google sign-in.' };
    }
    await shell.openExternal(data.url);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const { error } = await getClient().auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Finish a browser OAuth round-trip from `talysman://auth/callback?code=...`. */
export async function completeOAuth(code: string): Promise<void> {
  const { error } = await getClient().auth.exchangeCodeForSession(code);
  if (error) {
    logger.error('[auth] exchangeCodeForSession failed', error.message);
    throw new Error(error.message);
  }
}

export async function signOut(): Promise<{ ok: boolean; message?: string }> {
  try {
    if (isAuthConfigured()) await getClient().auth.signOut();
    await clearSession();
    return { ok: true };
  } catch (e) {
    await clearSession();
    return { ok: false, message: (e as Error).message };
  }
}
