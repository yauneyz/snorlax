// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  track: vi.fn().mockResolvedValue(undefined),
  reportUsage: vi.fn().mockResolvedValue(undefined),
  requireBearerUser: vi.fn(),
}));

vi.mock("@/server/analytics/track", () => ({
  track: mocks.track,
  reportUsage: mocks.reportUsage,
}));
vi.mock("@/lib/auth/require-bearer-user", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireBearerUser: mocks.requireBearerUser,
}));

import { POST as trackPost } from "@/app/api/analytics/track/route";
import { POST as usagePost } from "@/app/api/analytics/usage/route";
import {
  attributionFromRequest,
  resetAnalyticsRateLimitsForTests,
} from "@/server/analytics/ingest";

const anonId = "00000000-0000-4000-8000-000000000001";
const deviceId = "00000000-0000-4000-8000-000000000002";

function request(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAnalyticsRateLimitsForTests();
});

describe("POST /api/analytics/track", () => {
  it("rejects unknown event names and excessive props", async () => {
    const unknown = await trackPost(request("/api/analytics/track", { event: "made_up", source: "web" }));
    expect(unknown.status).toBe(400);

    const props = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`key_${i}`, i]));
    const excessive = await trackPost(request("/api/analytics/track", { event: "signed_in", source: "web", props }));
    expect(excessive.status).toBe(400);
  });

  it("enforces the byte cap", async () => {
    const response = await trackPost(request("/api/analytics/track", JSON.stringify({
      event: "signed_in", source: "web", props: { padding: "x".repeat(9_000) },
    })));
    expect(response.status).toBe(413);
  });

  it("takes anon_id only from the cookie and classifies HeadlessChrome reversibly", async () => {
    const response = await trackPost(request(
      "/api/analytics/track?utm_source=reddit",
      { event: "page_viewed", source: "web", props: { path: "/" } },
      { cookie: `tal_aid=${anonId}`, "user-agent": "HeadlessChrome/131" },
    ));
    expect(response.status).toBe(202);
    expect(mocks.track).toHaveBeenCalledWith(expect.objectContaining({
      anonId,
      attribution: expect.objectContaining({ utm_source: "reddit" }),
      props: expect.objectContaining({ ua_class: "bot" }),
    }));

    const bodyAnon = await trackPost(request("/api/analytics/track", {
      event: "signed_in", source: "web", anon_id: anonId,
    }));
    expect(bodyAnon.status).toBe(400);
  });

  it("passes timestamps to the seam, where source-specific clamping is enforced", async () => {
    const occurredAt = "2020-01-01T00:00:00.000Z";
    const response = await trackPost(request("/api/analytics/track", {
      event: "signed_in", source: "web", occurred_at: occurredAt,
    }));
    expect(response.status).toBe(202);
    expect(mocks.track).toHaveBeenCalledWith(expect.objectContaining({ occurredAt }));
  });
});

describe("POST /api/analytics/usage", () => {
  const today = new Date().toISOString().slice(0, 10);

  it("accepts a bounded partial daily row and stamps the top-level device", async () => {
    const response = await usagePost(request("/api/analytics/usage", {
      device_id: deviceId,
      rows: [{ local_date: today, tz_offset_minutes: -420, platform: "linux", focus_seconds: 86_400 }],
    }));
    expect(response.status).toBe(202);
    expect(mocks.reportUsage).toHaveBeenCalledWith(expect.objectContaining({
      deviceId,
      rows: [expect.objectContaining({ device_id: deviceId, focus_seconds: 86_400 })],
    }));
  });

  it("rejects counter overflow, too many rows, and dates outside the 40-day window", async () => {
    const overflow = await usagePost(request("/api/analytics/usage", {
      device_id: deviceId,
      rows: [{ local_date: today, tz_offset_minutes: 0, platform: "linux", app_opens: 32_768 }],
    }));
    expect(overflow.status).toBe(400);

    const tooMany = await usagePost(request("/api/analytics/usage", {
      device_id: deviceId,
      rows: Array.from({ length: 41 }, () => ({ local_date: today, tz_offset_minutes: 0, platform: "linux" })),
    }));
    expect(tooMany.status).toBe(400);

    const old = await usagePost(request("/api/analytics/usage", {
      device_id: deviceId,
      rows: [{ local_date: "2020-01-01", tz_offset_minutes: 0, platform: "linux" }],
    }));
    expect(old.status).toBe(400);
  });
});

describe("attributionFromRequest", () => {
  function attrRequest(headers: Record<string, string>) {
    return new NextRequest("https://talysman.app/api/analytics/track", {
      method: "POST",
      headers,
    });
  }

  it("prefers the client's document.referrer over the beacon's own Referer header", () => {
    const attribution = attributionFromRequest(
      attrRequest({ referer: "https://talysman.app/pricing" }),
      { path: "/", referrer_host: "old.reddit.com" },
    );
    expect(attribution.referrer_host).toBe("old.reddit.com");
  });

  it("drops a self-referral so first-touch stays open for a real channel", () => {
    const attribution = attributionFromRequest(
      attrRequest({ referer: "https://www.talysman.app/download" }),
      { path: "/" },
    );
    expect(attribution.referrer_host).toBeUndefined();
  });

  it("drops a self-referral reported by the client too", () => {
    const attribution = attributionFromRequest(attrRequest({}), {
      path: "/",
      referrer_host: "talysman.app",
    });
    expect(attribution.referrer_host).toBeUndefined();
  });

  it("keeps a cross-site Referer header when the client sent no referrer", () => {
    const attribution = attributionFromRequest(
      attrRequest({ referer: "https://chatgpt.com/c/abc" }),
      { path: "/" },
    );
    expect(attribution.referrer_host).toBe("chatgpt.com");
  });

  it("ignores an unparseable client referrer_host", () => {
    const attribution = attributionFromRequest(
      attrRequest({ referer: "https://chatgpt.com/c/abc" }),
      { path: "/", referrer_host: "not a host" },
    );
    expect(attribution.referrer_host).toBe("chatgpt.com");
  });
});
