/**
 * Session persistence via Electron safeStorage (DPAPI on Windows / Keychain on macOS).
 * Stub for phases 1-2; Phase 3 stores/loads the Supabase refresh token here.
 */

export async function loadSession(): Promise<string | null> {
  return null;
}

export async function saveSession(_token: string): Promise<void> {
  /* Phase 3 */
}

export async function clearSession(): Promise<void> {
  /* Phase 3 */
}
