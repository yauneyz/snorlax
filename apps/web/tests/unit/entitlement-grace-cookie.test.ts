import { describe, expect, it } from "vitest";
import {
  createEntitlementGraceCookie,
  entitlementGraceCookieIsValid,
} from "@/lib/auth/entitlement-grace";

describe("web entitlement grace cookie", () => {
  it("is user scoped and expires after the shared one-month policy", () => {
    const verifiedAt = "2026-07-01T00:00:00.000Z";
    const cookie = createEntitlementGraceCookie("user-a", verifiedAt);

    expect(
      entitlementGraceCookieIsValid(cookie, "user-a", new Date("2026-07-31T00:00:00.000Z")),
    ).toBe(true);
    expect(
      entitlementGraceCookieIsValid(cookie, "user-a", new Date("2026-07-31T00:00:00.001Z")),
    ).toBe(false);
    expect(
      entitlementGraceCookieIsValid(cookie, "user-b", new Date("2026-07-15T00:00:00.000Z")),
    ).toBe(false);
  });

  it("rejects tampering", () => {
    const cookie = createEntitlementGraceCookie("user-a", "2026-07-01T00:00:00.000Z");
    expect(
      entitlementGraceCookieIsValid(`${cookie}x`, "user-a", new Date("2026-07-15T00:00:00.000Z")),
    ).toBe(false);
  });
});
