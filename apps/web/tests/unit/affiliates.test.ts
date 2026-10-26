// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const lookup = vi.hoisted(() => ({
  row: null as { slug: string; landing_path: string } | null,
  error: null as { message: string } | null,
  filters: [] as Array<[string, unknown]>,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          lookup.filters.push([column, value]);
          return query;
        },
        maybeSingle: async () => ({ data: lookup.row, error: lookup.error }),
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/sentry", () => ({ captureException: vi.fn() }));

import { GET } from "@/app/r/[slug]/route";
import { config } from "@/lib/config";
import { affiliateLandingUrl } from "@/server/affiliates";
import { channelLabel, channelOf } from "@/server/analytics/channel";
import { addMonths, owed, referralEarnings } from "../../scripts/affiliates/earnings";

function visit(slug: string) {
  return GET(new NextRequest(`https://www.talysman.app/r/${slug}`), {
    params: Promise.resolve({ slug }),
  });
}

beforeEach(() => {
  lookup.row = null;
  lookup.error = null;
  lookup.filters = [];
});

describe("GET /r/[slug]", () => {
  it("redirects an active affiliate to its landing page with affiliate UTMs", async () => {
    lookup.row = { slug: "maya", landing_path: "/pricing" };
    const response = await visit("Maya");
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe(new URL(config.app.url).origin);
    expect(location.pathname).toBe("/pricing");
    expect(location.searchParams.get("utm_source")).toBe("maya");
    expect(location.searchParams.get("utm_medium")).toBe("affiliate");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(lookup.filters).toEqual([
      ["slug", "maya"],
      ["active", true],
    ]);
  });

  it("lands an unknown or paused slug on the home page without credit", async () => {
    const response = await visit("nobody");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(new URL("/", config.app.url).href);
  });

  it("never queries for a malformed slug", async () => {
    const response = await visit("..%2Fadmin");
    expect(response.headers.get("location")).toBe(new URL("/", config.app.url).href);
    expect(lookup.filters).toEqual([]);
  });

  it("still lands on the home page when the lookup fails", async () => {
    lookup.error = { message: "down" };
    const response = await visit("maya");
    expect(response.headers.get("location")).toBe(new URL("/", config.app.url).href);
  });
});

describe("affiliateLandingUrl", () => {
  it("refuses to leave the site even if a bad landing path got into the table", () => {
    for (const landing_path of ["//evil.example", "/\\evil.example", "https://evil.example"]) {
      const url = affiliateLandingUrl("https://www.talysman.app", { slug: "maya", landing_path });
      expect(url.origin).toBe("https://www.talysman.app");
      expect(url.pathname).toBe("/");
    }
  });
});

describe("channelOf with an affiliate", () => {
  it("files the person under the affiliate even when first-touch was elsewhere", () => {
    const person = {
      first_utm_source: null,
      first_utm_medium: null,
      first_referrer_host: "www.google.com",
    };
    expect(channelLabel(person)).toBe("google (organic)");
    expect(channelOf({ ...person, affiliate_slug: "maya" })).toEqual({
      channel: "maya",
      medium: "affiliate",
    });
  });
});

describe("referralEarnings", () => {
  const day = 86_400;
  const clicked = Date.UTC(2026, 0, 10) / 1000;
  const charge = (offsetDays: number, amount: number, extra: Partial<{ amount_refunded: number; status: string; currency: string }> = {}) => ({
    id: `ch_${offsetDays}`,
    created: clicked + offsetDays * day,
    amount,
    amount_refunded: extra.amount_refunded ?? 0,
    currency: extra.currency ?? "usd",
    status: extra.status ?? "succeeded",
  });
  const terms = {
    attributedAt: new Date(clicked * 1000).toISOString(),
    commissionBps: 3000,
    commissionMonths: 12,
  };

  it("pays on charges inside the window, net of refunds", () => {
    const result = referralEarnings(
      [charge(14, 999), charge(45, 999, { amount_refunded: 500 }), charge(76, 999, { status: "failed" })],
      terms,
    );
    expect(result.eligible).toEqual({ usd: 1498 });
    expect(result.commission).toEqual({ usd: 449 });
    expect(result.firstPaidAt).toBe(new Date((clicked + 14 * day) * 1000).toISOString());
  });

  it("excludes charges from before the click and after the window", () => {
    const result = referralEarnings([charge(-30, 999), charge(1, 999), charge(400, 999)], terms);
    expect(result.eligible).toEqual({ usd: 999 });
    expect(result.ineligible).toEqual({ usd: 1998 });
  });

  it("earns nothing without a payment", () => {
    const result = referralEarnings([], terms);
    expect(result.commission).toEqual({});
    expect(result.firstPaidAt).toBeNull();
  });

  it("clamps month-end windows", () => {
    expect(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("subtracts payouts per currency", () => {
    expect(owed({ usd: 4490 }, { usd: 3000, eur: 100 })).toEqual({ usd: 1490, eur: -100 });
  });
});
