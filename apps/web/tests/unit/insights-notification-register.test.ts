// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authorized: true,
  upsert: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@/server/insights/auth", () => ({
  hasValidInsightsBearer: () => mocks.authorized,
}));

vi.mock("@/lib/sentry", () => ({ captureException: mocks.captureException }));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: () => ({ upsert: mocks.upsert }),
  }),
}));

import { POST } from "@/app/api/analytics/notifications/register/route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/analytics/notifications/register", {
    method: "POST",
    headers: { Authorization: "Bearer widget-token", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorized = true;
  mocks.upsert.mockResolvedValue({ error: null });
});

describe("POST /api/analytics/notifications/register", () => {
  it("upserts an authenticated Android FCM token", async () => {
    const token = "fcm-token-that-is-long-enough";
    const response = await POST(request({ token, platform: "android" }));

    expect(response.status).toBe(204);
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ token, platform: "android", enabled: true }),
      { onConflict: "token" },
    );
  });

  it("rejects unauthorized and malformed registrations", async () => {
    mocks.authorized = false;
    expect((await POST(request({ token: "fcm-token-that-is-long-enough", platform: "android" }))).status)
      .toBe(401);

    mocks.authorized = true;
    expect((await POST(request({ token: "short", platform: "android" }))).status).toBe(400);
    expect((await POST(request({ token: "fcm-token-that-is-long-enough", platform: "ios" }))).status)
      .toBe(400);
  });

  it("reports storage failures without exposing details", async () => {
    mocks.upsert.mockResolvedValue({ error: new Error("database unavailable") });
    const response = await POST(
      request({ token: "fcm-token-that-is-long-enough", platform: "android" }),
    );

    expect(response.status).toBe(500);
    expect(mocks.captureException).toHaveBeenCalledOnce();
  });
});
