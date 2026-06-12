/**
 * Pure pairing/recovery crypto helpers (architecture §5). These mirror what the Rust service
 * does authoritatively; here they back the mock service, tests, and recovery-code formatting.
 *
 * Uses node:crypto (available in the Electron main process and test runner). The renderer
 * never imports this — all secrets stay in privileged/main contexts.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Number of random bytes in a pairing secret (256-bit). */
export const SECRET_BYTES = 32;
/** Salt length for stored hashes. */
export const SALT_BYTES = 16;

export interface SaltedHash {
  /** hex-encoded salt */
  salt: string;
  /** hex-encoded sha256(salt || secret) */
  hash: string;
}

/** Generate a fresh 256-bit pairing secret as raw bytes. */
export function generateSecret(): Buffer {
  return randomBytes(SECRET_BYTES);
}

/** Salt-and-hash a secret for at-rest storage. */
export function hashSecret(secret: Buffer, salt: Buffer = randomBytes(SALT_BYTES)): SaltedHash {
  const hash = createHash('sha256').update(salt).update(secret).digest('hex');
  return { salt: salt.toString('hex'), hash };
}

/** Constant-time verification of a secret against a stored salted hash. */
export function verifySecret(secret: Buffer, stored: SaltedHash): boolean {
  const salt = Buffer.from(stored.salt, 'hex');
  const computed = createHash('sha256').update(salt).update(secret).digest();
  const expected = Buffer.from(stored.hash, 'hex');
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}

// ---------------------------------------------------------------------------
// Recovery code (the killswitch secret)
// ---------------------------------------------------------------------------

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 ambiguity
const RECOVERY_GROUPS = 3;
const RECOVERY_GROUP_LEN = 4;

/** Generate a human-friendly recovery code, e.g. "K7QF-2M9X-RT4P". */
export function generateRecoveryCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < RECOVERY_GROUPS; g++) {
    let s = '';
    const bytes = randomBytes(RECOVERY_GROUP_LEN);
    for (let i = 0; i < RECOVERY_GROUP_LEN; i++) {
      s += RECOVERY_ALPHABET[bytes[i]! % RECOVERY_ALPHABET.length];
    }
    groups.push(s);
  }
  return groups.join('-');
}

/** Canonicalize a user-entered code (uppercase, strip non-alphabet, re-hyphenate). */
export function normalizeRecoveryCode(input: string): string {
  const cleaned = input
    .toUpperCase()
    .split('')
    .filter((c) => RECOVERY_ALPHABET.includes(c))
    .join('');
  const groups: string[] = [];
  for (let i = 0; i < cleaned.length; i += RECOVERY_GROUP_LEN) {
    groups.push(cleaned.slice(i, i + RECOVERY_GROUP_LEN));
  }
  return groups.join('-');
}

/** Hash a recovery code for storage (treats the normalized string as the secret). */
export function hashRecoveryCode(code: string, salt?: Buffer): SaltedHash {
  return hashSecret(Buffer.from(normalizeRecoveryCode(code), 'utf8'), salt);
}

/** Verify a user-entered recovery code against the stored hash. */
export function verifyRecoveryCode(code: string, stored: SaltedHash): boolean {
  return verifySecret(Buffer.from(normalizeRecoveryCode(code), 'utf8'), stored);
}
