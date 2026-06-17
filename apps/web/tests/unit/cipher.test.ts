import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "@/lib/connections/cipher";

describe("token cipher (AES-256-GCM)", () => {
  it("round-trips an arbitrary string", () => {
    const plaintext = JSON.stringify({ access_token: "ya29.abc", refresh_token: "1//def" });
    const sealed = encrypt(plaintext);
    expect(decrypt(sealed)).toBe(plaintext);
  });

  it("produces a fresh IV on every call", () => {
    const a = encrypt("same-plaintext");
    const b = encrypt("same-plaintext");
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("throws when the auth tag has been tampered with", () => {
    const sealed = encrypt("secret-payload");
    const bad = Buffer.from(sealed.tag);
    bad[0] = bad[0] ^ 0xff;
    expect(() => decrypt({ ...sealed, tag: bad })).toThrow();
  });

  it("throws when the ciphertext has been tampered with", () => {
    const sealed = encrypt("secret-payload");
    const bad = Buffer.from(sealed.ciphertext);
    bad[0] = bad[0] ^ 0xff;
    expect(() => decrypt({ ...sealed, ciphertext: bad })).toThrow();
  });
});
