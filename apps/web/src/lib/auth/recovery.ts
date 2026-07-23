/**
 * Supabase emits PASSWORD_RECOVERY after exchanging a recovery code from the current URL.
 * This also handles recovery links that fell back to the configured Site URL instead of the
 * requested /reset-password redirect.
 */
export function recoveryRedirectForAuthEvent(event: string): "/reset-password" | null {
  return event === "PASSWORD_RECOVERY" ? "/reset-password" : null;
}
