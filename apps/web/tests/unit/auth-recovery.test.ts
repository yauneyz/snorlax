import { describe, expect, it } from "vitest";
import { recoveryRedirectForAuthEvent } from "@/lib/auth/recovery";

describe("password recovery redirect", () => {
  it("routes a consumed recovery link to the new-password form", () => {
    expect(recoveryRedirectForAuthEvent("PASSWORD_RECOVERY")).toBe("/reset-password");
  });

  it("does not reroute ordinary auth events", () => {
    expect(recoveryRedirectForAuthEvent("SIGNED_IN")).toBeNull();
    expect(recoveryRedirectForAuthEvent("INITIAL_SESSION")).toBeNull();
    expect(recoveryRedirectForAuthEvent("SIGNED_OUT")).toBeNull();
  });
});
