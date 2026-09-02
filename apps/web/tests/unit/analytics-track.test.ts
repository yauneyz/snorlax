// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  insert: vi.fn(),
  captureException: vi.fn(),
  posthogCapture: vi.fn(),
  posthogFlush: vi.fn(),
  getPosthogServer: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    rpc: mocks.rpc,
    from: () => ({ insert: mocks.insert }),
  }),
}));
vi.mock("@/lib/sentry", () => ({ captureException: mocks.captureException }));
vi.mock("@/lib/analytics/posthog-server", () => ({
  getPosthogServer: mocks.getPosthogServer,
}));

import {
  clampOccurredAt,
  deriveIdempotencyKey,
  ingestAllowed,
  reportUsage,
  track,
} from "@/server/analytics/track";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: "person-1", error: null });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.getPosthogServer.mockReturnValue(null);
  mocks.posthogFlush.mockResolvedValue(undefined);
});

describe("ingestAllowed", () => {
  it("allows writes in a production build regardless of target", () => {
    expect(ingestAllowed("production", "https://abc.supabase.co")).toBe(true);
  });

  it("blocks a dev build from writing to a remote database", () => {
    // This is the guard that keeps `pnpm web:prod` — a `next dev` server pointed at the
    // PRODUCTION database — from writing your own browsing into the real funnel.
    expect(ingestAllowed("development", "https://abc.supabase.co")).toBe(false);
  });

  it("allows a dev build to write to local postgres", () => {
    // The bot E2E suite depends on this being true under `pnpm web:dev`.
    expect(ingestAllowed("development", "http://127.0.0.1:54321")).toBe(true);
    expect(ingestAllowed("development", "http://localhost:54321")).toBe(true);
  });

  it("fails closed on an unparseable url", () => {
    expect(ingestAllowed("development", "not-a-url")).toBe(false);
  });
});

describe("clampOccurredAt", () => {
  const now = new Date("2026-08-10T12:00:00.000Z");

  it("passes a plausible timestamp through unchanged", () => {
    const at = new Date("2026-08-10T11:30:00.000Z");
    expect(clampOccurredAt(at, "web", now)).toBe(at.toISOString());
  });

  it("clamps a far-future client clock back to a bounded window", () => {
    const result = clampOccurredAt(new Date("2027-01-01T00:00:00.000Z"), "web", now);
    expect(new Date(result).getTime()).toBe(now.getTime() + 3600_000);
  });

  it("clamps a web event more tightly than a desktop one", () => {
    // §7 specifies a flat +/-24h, which contradicts §6.5 and §9.3: the desktop keeps a
    // 35-day offline queue precisely so a machine offline for weeks reports accurately, and
    // a 24h clamp would destroy the timestamps that buffer exists to preserve.
    const tenDaysAgo = new Date("2026-07-31T12:00:00.000Z");
    const web = clampOccurredAt(tenDaysAgo, "web", now);
    const desktop = clampOccurredAt(tenDaysAgo, "desktop", now);

    expect(new Date(web).getTime()).toBe(now.getTime() - 24 * 3600_000);
    expect(desktop).toBe(tenDaysAgo.toISOString());
  });

  it("still clamps a desktop event beyond the offline log horizon", () => {
    const result = clampOccurredAt(new Date("2026-01-01T00:00:00.000Z"), "desktop", now);
    expect(new Date(result).getTime()).toBe(now.getTime() - 35 * 24 * 3600_000);
  });

  it("falls back to now for a missing or garbage timestamp", () => {
    expect(clampOccurredAt(null, "web", now)).toBe(now.toISOString());
    expect(clampOccurredAt("banana", "web", now)).toBe(now.toISOString());
  });
});

describe("deriveIdempotencyKey", () => {
  const base = { event: "signed_in", source: "web" } as const;

  it("returns null for a repeatable event", () => {
    expect(deriveIdempotencyKey({ ...base, anonId: "a1" })).toBeNull();
  });

  it("derives a key for a once-per-person event", () => {
    // Makes "once per person, ever" a database guarantee, so account_created is safe to
    // emit from both the client-side signup form and the OAuth callback route.
    expect(deriveIdempotencyKey({ event: "account_created", source: "web", userId: "u1" })).toBe(
      "account_created:u1",
    );
  });

  it("prefers the most durable identifier available", () => {
    expect(
      deriveIdempotencyKey({
        event: "app_installed",
        source: "desktop",
        anonId: "a1",
        deviceId: "d1",
        userId: "u1",
      }),
    ).toBe("app_installed:u1");
    expect(
      deriveIdempotencyKey({ event: "app_installed", source: "desktop", deviceId: "d1" }),
    ).toBe("app_installed:d1");
  });

  it("honours an explicit key over the derived one", () => {
    expect(
      deriveIdempotencyKey({ event: "account_created", source: "web", userId: "u1", idempotencyKey: "x" }),
    ).toBe("x");
  });

  it("returns null when there is no identifier to scope by", () => {
    expect(deriveIdempotencyKey({ event: "account_created", source: "web" })).toBeNull();
  });
});

describe("track", () => {
  it("links identities then inserts the event", async () => {
    await track({ event: "page_viewed", source: "web", anonId: "a1", props: { path: "/" } });

    expect(mocks.rpc).toHaveBeenCalledWith("analytics_link", {
      p_identifiers: ["anon:a1"],
      p_attribution: {},
    });
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(mocks.insert.mock.calls[0][0]).toMatchObject({
      event: "page_viewed",
      source: "web",
      anon_id: "a1",
    });
  });

  it("passes all three identifier spaces, prefixed", async () => {
    await track({ event: "signed_in", source: "desktop", anonId: "a1", deviceId: "d1", userId: "u1" });
    expect(mocks.rpc.mock.calls[0][1].p_identifiers).toEqual(["anon:a1", "device:d1", "user:u1"]);
  });

  it("denormalizes attribution onto the event row", async () => {
    await track({
      event: "download_clicked",
      source: "server",
      anonId: "a1",
      attribution: { utm_source: "reddit", referrer_host: "reddit.com" },
      props: { platform: "linux" },
    });
    expect(mocks.insert.mock.calls[0][0]).toMatchObject({
      utm_source: "reddit",
      referrer_host: "reddit.com",
    });
  });

  it("never throws when the database is down, and reports to Sentry", async () => {
    // The whole contract of this seam: analytics must never break a user flow.
    mocks.rpc.mockRejectedValue(new Error("connection refused"));
    await expect(track({ event: "page_viewed", source: "web", anonId: "a1" })).resolves.toBeUndefined();
    expect(mocks.captureException).toHaveBeenCalledOnce();
  });

  it("never throws when the insert returns an error", async () => {
    mocks.insert.mockResolvedValue({ error: { code: "42501", message: "permission denied" } });
    await expect(track({ event: "page_viewed", source: "web", anonId: "a1" })).resolves.toBeUndefined();
    expect(mocks.captureException).toHaveBeenCalledOnce();
  });

  it("treats a duplicate idempotency_key as success, not an error", async () => {
    // A replayed desktop flush, or a once-per-person event firing from its second call
    // site. Both are expected, and neither is worth a Sentry event.
    mocks.insert.mockResolvedValue({
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    await track({ event: "account_created", source: "web", userId: "u1" });
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it("does not fan a duplicate idempotency_key out to PostHog", async () => {
    // Supabase dedupes via the unique index, but PostHog has no equivalent — capturing on a
    // 23505 no-op would inflate PostHog's count past Supabase's for once-per-person events.
    mocks.getPosthogServer.mockReturnValue({ capture: mocks.posthogCapture, flush: mocks.posthogFlush });
    mocks.insert.mockResolvedValue({
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    await track({ event: "account_created", source: "web", userId: "u1" });
    expect(mocks.posthogCapture).not.toHaveBeenCalled();
  });

  it("fans out web events to PostHog but not desktop ones", async () => {
    mocks.getPosthogServer.mockReturnValue({ capture: mocks.posthogCapture, flush: mocks.posthogFlush });

    await track({ event: "page_viewed", source: "web", anonId: "a1", props: { path: "/" } });
    expect(mocks.posthogCapture).toHaveBeenCalledOnce();

    mocks.posthogCapture.mockClear();
    await track({ event: "app_installed", source: "desktop", deviceId: "d1" });
    expect(mocks.posthogCapture).not.toHaveBeenCalled();
  });

  it("flushes the PostHog client so a serverless freeze can't drop the buffered event", async () => {
    // posthog-node batches capture() calls and only sends them at a size/time threshold. A
    // Vercel function is frozen right after it returns, so without an awaited flush() here a
    // captured event can sit in the client's in-memory queue and never actually be sent.
    mocks.getPosthogServer.mockReturnValue({ capture: mocks.posthogCapture, flush: mocks.posthogFlush });
    await track({ event: "page_viewed", source: "web", anonId: "a1" });
    expect(mocks.posthogFlush).toHaveBeenCalledOnce();
  });

  it("survives a throwing PostHog client without losing the Supabase write", async () => {
    mocks.getPosthogServer.mockReturnValue({
      capture: () => {
        throw new Error("posthog exploded");
      },
    });
    await expect(track({ event: "page_viewed", source: "web", anonId: "a1" })).resolves.toBeUndefined();
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(mocks.captureException).not.toHaveBeenCalled();
  });
});

describe("reportUsage", () => {
  const row = {
    device_id: "d1",
    local_date: "2026-08-01",
    tz_offset_minutes: 0,
    platform: "linux",
    focus_seconds: 60,
  };

  it("stamps the verified user_id onto every row rather than trusting the payload", async () => {
    await reportUsage({ deviceId: "d1", userId: "u1", rows: [row] });
    const call = mocks.rpc.mock.calls.find((c) => c[0] === "analytics_report_usage");
    expect(call?.[1].p_rows[0]).toMatchObject({ device_id: "d1", user_id: "u1" });
  });

  it("does nothing for an empty batch", async () => {
    await reportUsage({ deviceId: "d1", rows: [] });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("never throws when the rpc fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(reportUsage({ deviceId: "d1", rows: [row] })).resolves.toBeUndefined();
    expect(mocks.captureException).toHaveBeenCalled();
  });
});
