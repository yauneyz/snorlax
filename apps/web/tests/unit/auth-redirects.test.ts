import { describe, expect, it } from "vitest";
import { authErrorMessage, authRedirectTarget, safeInternalPath } from "@/lib/auth/redirects";

describe("auth redirects", () => {
  it("keeps same-origin paths and rejects external URL forms", () => {
    expect(safeInternalPath("/app?tab=account")).toBe("/app?tab=account");
    expect(safeInternalPath("https://evil.example")).toBe("/app");
    expect(safeInternalPath("//evil.example/path")).toBe("/app");
    expect(safeInternalPath("/\\evil.example/path")).toBe("/app");
  });

  it("allows only known desktop authentication callbacks", () => {
    expect(authRedirectTarget("https://talysman.app", "talysman://auth/callback?code=x")).toBe(
      "talysman://auth/callback?code=x",
    );
    expect(authRedirectTarget("https://talysman.app", "talysman://billing/success")).toBe(
      "https://talysman.app/app",
    );
  });

  it("maps callback codes to user-facing messages", () => {
    expect(authErrorMessage("access_denied")).toMatch(/cancelled/i);
    expect(authErrorMessage("exchange_failed")).toMatch(/could not be completed/i);
  });
});
