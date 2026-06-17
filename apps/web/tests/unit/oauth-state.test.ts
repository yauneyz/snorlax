import { describe, expect, it } from "vitest";
import { signState, verifyState } from "@/lib/oauth/state";

describe("oauth state signer", () => {
  it("round-trips a payload", () => {
    const token = signState({ nonce: "abc-123", returnTo: "/app/data-sources/gsc" });
    expect(verifyState(token)).toEqual({ nonce: "abc-123", returnTo: "/app/data-sources/gsc" });
  });

  it("rejects a tampered signature", () => {
    const token = signState({ nonce: "abc" });
    const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(verifyState(tampered)).toBeNull();
  });

  it("rejects a tampered body", () => {
    const token = signState({ nonce: "abc" });
    const [body, sig] = token.split(".");
    const altered = body.slice(0, -1) + (body.endsWith("A") ? "B" : "A");
    expect(verifyState(`${altered}.${sig}`)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(verifyState("nodot")).toBeNull();
    expect(verifyState("")).toBeNull();
  });
});
