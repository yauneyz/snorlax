/** Pure sign-up response classification, split from supabase.ts so it is unit-testable. */

export type SignUpOutcome = 'signedIn' | 'confirmEmail' | 'alreadyRegistered';

/**
 * Interpret an `auth.signUp` response. With confirmations off Supabase returns a session;
 * with them on it returns only a user. An existing email comes back obfuscated as a user
 * with an empty identities array.
 */
export function classifySignUpResult(data: {
  user: { identities?: unknown[] | null } | null;
  session: unknown;
}): SignUpOutcome {
  if (data.session) return 'signedIn';
  if (data.user?.identities && data.user.identities.length === 0) return 'alreadyRegistered';
  return 'confirmEmail';
}
