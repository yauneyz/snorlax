import { createHash, randomInt } from "node:crypto";

/**
 * Complimentary-access redemption codes.
 *
 * A code is a secret: only its sha256 is stored (`comp_codes.code_hash`), so a
 * database leak can't be redeemed and a lost code can only be re-issued, never
 * recovered. Generation, normalization, and hashing all live here so the CLI
 * that mints codes and the route that redeems them can't drift apart.
 */

/** Crockford base32 minus I/L/O/U — unambiguous when read aloud or retyped. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const GROUPS = 2;
const GROUP_LENGTH = 4;
const PREFIX = "TLY";

/** Mint a new code, e.g. `TLY-4K2P-9XQR`. ~40 bits of entropy. */
export function generateCompCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g += 1) {
    let group = "";
    for (let i = 0; i < GROUP_LENGTH; i += 1) {
      group += ALPHABET[randomInt(ALPHABET.length)];
    }
    groups.push(group);
  }
  return [PREFIX, ...groups].join("-");
}

/**
 * Canonical form for hashing: uppercase, dashes/spaces stripped, and the common
 * transcription slips folded (O→0, I/L→1) so a retyped code still matches.
 */
export function normalizeCompCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

export function hashCompCode(input: string): string {
  return createHash("sha256").update(normalizeCompCode(input)).digest("hex");
}

/** Cheap shape check so obviously-wrong input never reaches the database. */
export function looksLikeCompCode(input: string): boolean {
  const normalized = normalizeCompCode(input);
  return normalized.length >= 8 && normalized.length <= 32;
}
