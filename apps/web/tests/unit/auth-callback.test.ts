import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const exchangeCodeForSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({ auth: { exchangeCodeForSession } }),
}));

import { GET } from "@/app/api/auth/callback/route";

function request(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/auth/callback${query}`);
}

describe("auth callback", () => {
  beforeEach(() => exchangeCodeForSession.mockReset());

  it("creates the session and redirects to a safe internal destination", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await GET(request("?code=valid&next=%2Fapp%3Ftab%3Daccount"));

    expect(exchangeCodeForSession).toHaveBeenCalledWith("valid");
    expect(response.headers.get("location")).toBe("http://localhost:3000/app?tab=account");
  });

  it("rejects external destinations", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await GET(request("?code=valid&next=https%3A%2F%2Fevil.example"));

    expect(response.headers.get("location")).toBe("http://localhost:3000/app");
  });

  it("returns friendly error codes for cancellation and failed exchanges", async () => {
    const cancelled = await GET(request("?error=access_denied&next=%2Fpricing"));
    expect(cancelled.headers.get("location")).toContain("/login?error=access_denied");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();

    exchangeCodeForSession.mockResolvedValue({ error: new Error("sensitive provider detail") });
    const failed = await GET(request("?code=bad"));
    expect(failed.headers.get("location")).toContain("error=exchange_failed");
    expect(failed.headers.get("location")).not.toContain("sensitive");
  });

  it("returns signup failures to the signup surface", async () => {
    const response = await GET(request("?error=access_denied&flow=signup"));
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/signup?error=access_denied",
    );
  });
});
