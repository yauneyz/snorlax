import { createHmac, timingSafeEqual } from "node:crypto";
import { isWithinEntitlementGracePeriod } from "@talysman/product";
import { config } from "@/lib/config";

export const ENTITLEMENT_GRACE_COOKIE = "talysman-entitlement-grace";

interface GracePayload {
  v: 1;
  userId: string;
  verifiedAt: string;
}

function signature(payload: string): Buffer {
  return createHmac("sha256", config.security.oauthStateSecret).update(payload).digest();
}

export function createEntitlementGraceCookie(userId: string, verifiedAt: string): string {
  const payload = Buffer.from(
    JSON.stringify({ v: 1, userId, verifiedAt } satisfies GracePayload),
  ).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function entitlementGraceCookieIsValid(
  value: string | undefined,
  userId: string,
  now: Date = new Date(),
): boolean {
  if (!value) return false;
  const [payload, encodedSignature, extra] = value.split(".");
  if (!payload || !encodedSignature || extra) return false;

  const actual = Buffer.from(encodedSignature, "base64url");
  const expected = signature(payload);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as GracePayload;
    return (
      parsed.v === 1 &&
      parsed.userId === userId &&
      isWithinEntitlementGracePeriod(parsed.verifiedAt, now)
    );
  } catch {
    return false;
  }
}
