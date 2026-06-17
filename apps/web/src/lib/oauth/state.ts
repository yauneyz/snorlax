import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export type StatePayload = {
  nonce: string;
  returnTo?: string;
};

// Read env directly — see cipher.ts for the reason.
function secret(): string {
  const raw = process.env.OAUTH_STATE_SECRET;
  if (!raw) throw new Error("OAUTH_STATE_SECRET is not set");
  return raw;
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function hmac(payload: string): Buffer {
  return createHmac("sha256", secret()).update(payload).digest();
}

export function signState(payload: StatePayload): string {
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64urlEncode(hmac(body));
  return `${body}.${sig}`;
}

export function verifyState(token: string): StatePayload | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let givenSig: Buffer;
  try {
    givenSig = b64urlDecode(sig);
  } catch {
    return null;
  }
  const expectedSig = hmac(body);
  if (givenSig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(givenSig, expectedSig)) return null;

  try {
    const json = b64urlDecode(body).toString("utf8");
    const parsed = JSON.parse(json) as StatePayload;
    if (typeof parsed?.nonce !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}
