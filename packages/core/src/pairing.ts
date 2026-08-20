/**
 * Pure pairing crypto helpers (architecture §5). These mirror what the Rust service
 * does authoritatively and back the mock service and tests.
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
