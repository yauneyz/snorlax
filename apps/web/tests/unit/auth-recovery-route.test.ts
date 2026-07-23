import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const verifyOtp = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({ auth: { verifyOtp } }),
}));

import { POST } from "@/app/api/auth/recovery/route";

function request(tokenHash?: string): NextRequest {
  const body = new URLSearchParams();
  if (tokenHash !== undefined) body.set("token_hash", tokenHash);
  return new NextRequest("http://localhost:3000/api/auth/recovery", {
    method: "POST",
    body: body.toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
}

describe("password recovery verification", () => {
  beforeEach(() => verifyOtp.mockReset());

  it("verifies a recovery token and redirects to the new-password form", async () => {
    verifyOtp.mockResolvedValue({ error: null });

    const response = await POST(request("valid-token-hash"));

    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: "valid-token-hash",
      type: "recovery",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/reset-password");
  });

  it("returns invalid and expired tokens to a friendly recovery page", async () => {
    verifyOtp.mockResolvedValue({ error: new Error("expired") });

    const response = await POST(request("expired-token-hash"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/auth/recovery?error=invalid_or_expired",
    );
  });

  it("rejects malformed requests without calling Supabase", async () => {
    const response = await POST(request());

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
  });

  it("rejects non-form requests without throwing", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3000/api/auth/recovery", { method: "POST" }),
    );

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
  });
});
