import { describe, expect, it } from "vitest";
import { mintAnonId, parseAnonId } from "@/lib/analytics/anon-id";

describe("tal_aid helpers", () => {
  it("mints a valid opaque UUID", () => {
    const value = mintAnonId();
    expect(parseAnonId(value)).toBe(value);
  });

  it("rejects missing and malformed cookie values", () => {
    expect(parseAnonId(undefined)).toBeNull();
    expect(parseAnonId("not-a-uuid")).toBeNull();
    expect(parseAnonId("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
