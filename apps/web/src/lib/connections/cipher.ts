import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

// Read env directly: this module is server-only, and `@/lib/config`'s
// server/browser gate (`typeof window === "undefined"`) hides server values
// under jsdom in tests.
function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  return Buffer.from(raw, "base64");
}

export type Sealed = {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
};

export function encrypt(plaintext: string): Sealed {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

export function decrypt({ ciphertext, iv, tag }: Sealed): string {
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}
