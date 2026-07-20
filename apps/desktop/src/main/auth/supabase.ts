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
import {
  createClient,
  type SupabaseClient,
  type SupabaseClientOptions,
} from '@supabase/supabase-js';
import WebSocket from 'ws';
import {
  DESKTOP_AUTH_CALLBACK_PATH,
  DESKTOP_AUTH_RESET_CALLBACK_PATH,
  desktopDeepLinkUrl,
  type AuthStatus,
} from '@talysman/auth-contracts';
import { config } from '../config.js';
import { logger } from '../logging.js';
import { clearSession, supabaseAuthStorage } from './session.js';
import { classifySignUpResult } from './signUpResult.js';

let client: SupabaseClient | undefined;
let authChangeListener: (() => void) | undefined;

/**
 * True after a password-recovery link established a session, until the user picks a new
 * password. The renderer polls this through `authStatus`, so recovery survives cold-start
 * deep links where a broadcast would be lost.
 */
let passwordRecoveryPending = false;
let authFlowError: string | undefined;

type RealtimeTransport = NonNullable<
  NonNullable<SupabaseClientOptions<'public'>['realtime']>['transport']
>;

// `ws` implements the WebSocket API at runtime, but its overloaded Node constructor is not
// structurally assignable to Supabase's narrower browser-shaped constructor type.
const nodeWebSocketTransport = WebSocket as unknown as RealtimeTransport;

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
      realtime: { transport: nodeWebSocketTransport },
      auth: {
        flowType: 'pkce',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        storage: supabaseAuthStorage,
      },
    });
    client.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') passwordRecoveryPending = true;
      if (event === 'SIGNED_OUT') passwordRecoveryPending = false;
      authChangeListener?.();
    });
  }
  return client;
}

/** Registered by the IPC layer to push auth/entitlement changes to renderers. */
export function setAuthChangeListener(cb: () => void): void {
  authChangeListener = cb;
}

function clearAuthFlowError(): void {
  if (!authFlowError) return;
  authFlowError = undefined;
  authChangeListener?.();
}

/** Surface a sanitized browser/deep-link failure to the renderer. */
export function reportAuthFlowError(message: string): void {
  authFlowError = message;
  authChangeListener?.();
}

export async function getAuthStatus(): Promise<AuthStatus> {
  if (!isAuthConfigured())
    return {
      signedIn: false,
      ...(authFlowError ? { authError: authFlowError } : {}),
    };
  const { data } = await getClient().auth.getSession();
  const user = data.session?.user;
  if (!user)
    return {
      signedIn: false,
      ...(authFlowError ? { authError: authFlowError } : {}),
    };
  return {
    signedIn: true,
    email: user.email ?? undefined,
    ...(passwordRecoveryPending ? { passwordRecovery: true } : {}),
    ...(authFlowError ? { authError: authFlowError } : {}),
  };
}

/** Current access token for `Authorization: Bearer` calls, or null when signed out. */
export async function getAccessToken(): Promise<string | null> {
  if (!isAuthConfigured()) return null;
  const { data } = await getClient().auth.getSession();
  return data.session?.access_token ?? null;
}

/** Open the system browser for Google OAuth; completes via the auth/callback deep link. */
export async function signInWithGoogle(): Promise<{ ok: boolean; message?: string }> {
  if (!config.googleAuthEnabled) {
    return {
      ok: false,
      message: 'Google sign-in is not available in this environment.',
    };
  }
  try {
    clearAuthFlowError();
    const { data, error } = await getClient().auth.signInWithOAuth({
      provider: 'google',
      options: {
        skipBrowserRedirect: true,
        redirectTo: desktopDeepLinkUrl(DESKTOP_AUTH_CALLBACK_PATH),
      },
    });
    if (error || !data?.url) {
      return {
        ok: false,
        message: error?.message ?? 'Could not start Google sign-in.',
      };
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
    clearAuthFlowError();
    const { error } = await getClient().auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/**
 * Create an email/password account. When Supabase requires email confirmation, the
 * confirmation link redirects back through `talysman://auth/callback` and completes on this
 * machine (the PKCE verifier lives in our encrypted storage).
 */
export async function signUpWithPassword(
  email: string,
  password: string,
  fullName?: string,
): Promise<{ ok: boolean; confirmEmail?: boolean; message?: string }> {
  try {
    clearAuthFlowError();
    const { data, error } = await getClient().auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName || null },
        emailRedirectTo: desktopDeepLinkUrl(DESKTOP_AUTH_CALLBACK_PATH),
      },
    });
    if (error) return { ok: false, message: error.message };
    const outcome = classifySignUpResult(data);
    if (outcome === 'alreadyRegistered') {
      return { ok: false, message: 'An account with this email already exists - try signing in.' };
    }
    return { ok: true, confirmEmail: outcome === 'confirmEmail' };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Email a password-reset link that returns via `talysman://auth/reset-callback`. */
export async function sendPasswordReset(email: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const { error } = await getClient().auth.resetPasswordForEmail(email, {
      redirectTo: desktopDeepLinkUrl(DESKTOP_AUTH_RESET_CALLBACK_PATH),
    });
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Set a new password on the current session (used after a recovery deep link). */
export async function updatePassword(
  newPassword: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const { error } = await getClient().auth.updateUser({ password: newPassword });
    if (error) return { ok: false, message: error.message };
    passwordRecoveryPending = false;
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/**
 * Finish a browser round-trip from `talysman://auth/callback?code=...` or
 * `talysman://auth/reset-callback?code=...` (OAuth, email confirmation, password recovery).
 * `recovery` marks the session as awaiting a new password; we set it explicitly because a
 * manual code exchange emits SIGNED_IN, not PASSWORD_RECOVERY.
 */
export async function completeOAuth(code: string, opts?: { recovery?: boolean }): Promise<void> {
  const { error } = await getClient().auth.exchangeCodeForSession(code);
  if (error) {
    logger.error('[auth] exchangeCodeForSession failed', error.message);
    throw new Error(
      `${error.message} - email links must be opened on the computer that requested them; ` +
        'use the website to sign in or reset your password from another device.',
    );
  }
  if (opts?.recovery) {
    passwordRecoveryPending = true;
    authChangeListener?.();
  }
  clearAuthFlowError();
}

export async function signOut(): Promise<{ ok: boolean; message?: string }> {
  passwordRecoveryPending = false;
  clearAuthFlowError();
  try {
    if (isAuthConfigured()) await getClient().auth.signOut();
    await clearSession();
    return { ok: true };
  } catch (e) {
    await clearSession();
    return { ok: false, message: (e as Error).message };
  }
}
