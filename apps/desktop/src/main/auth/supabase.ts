/**
 * Supabase auth (architecture §10) lives in the MAIN process so tokens never reach the
 * renderer's DOM. Stub for phases 1-2; Phase 3 instantiates supabase-js from config and
 * persists the session via session.ts.
 */

export interface AuthStatus {
  signedIn: boolean;
  email?: string;
}

export async function getAuthStatus(): Promise<AuthStatus> {
  return { signedIn: false };
}
