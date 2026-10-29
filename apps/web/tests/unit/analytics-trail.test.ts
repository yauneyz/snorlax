// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", () => ({
  config: { stripe: { priceMonthly: "price_m", priceYearly: "price_y" }, insights: {} },
}));

import { PRO_PRICE_CENTS } from "@talysman/product";
import { mrrCents } from "@/server/analytics/queries/revenue";
import { MAX_JOURNEYS, toTrailMetrics } from "@/server/analytics/queries/trail";
import type { AnalyticsTrailOutcomeRow } from "@/lib/supabase/types";

const row = (fields: Partial<AnalyticsTrailOutcomeRow>): AnalyticsTrailOutcomeRow => ({
  layer: "source",
  channel: "x",
  kind: "social",
  people: 0,
  people_30d: 0,
  downloaded: 0,
  installed: 0,
  paired: 0,
  trials: 0,
  paid: 0,
  lifetime: 0,
  active_trials: 0,
  active_subs: 0,
  ...fields,
});

describe("mrrCents", () => {
  it("prices monthly at list and yearly over twelve months", () => {
    expect(mrrCents({ price_m: 2, price_y: 12 })).toBe(
      2 * PRO_PRICE_CENTS.monthly + PRO_PRICE_CENTS.yearly,
    );
  });

  it("adds nothing for a price id this deployment doesn't know", () => {
    expect(mrrCents({ price_old: 5 })).toBe(0);
    expect(mrrCents(null)).toBe(0);
  });
});

describe("toTrailMetrics", () => {
  it("splits the layers and puts what's paying now first, ahead of raw reach", () => {
    const trail = toTrailMetrics([
      row({ channel: "google", kind: "search", people: 500, paired: 20 }),
      row({ channel: "chatgpt", kind: "ai", people: 40, active_subs: 3 }),
      row({ channel: "reddit", people: 90, active_trials: 2 }),
      row({ layer: "blog", channel: "attention-armor", kind: "post", people: 10 }),
      row({ layer: "affiliate", channel: "(no affiliate)", kind: "none", people: 630 }),
    ]);
    expect(trail.sources.map((s) => s.channel)).toEqual(["chatgpt", "reddit", "google"]);
    expect(trail.blog).toHaveLength(1);
    expect(trail.affiliates[0]).toMatchObject({ channel: "(no affiliate)", people: 630 });
  });

  it("keeps only the busiest journeys", () => {
    const rows = Array.from({ length: MAX_JOURNEYS + 5 }, (_, i) =>
      row({ layer: "journey", channel: `j${i}`, people: i }),
    );
    const { journeys } = toTrailMetrics(rows);
    expect(journeys).toHaveLength(MAX_JOURNEYS);
    expect(journeys[0].people).toBe(MAX_JOURNEYS + 4);
  });
});
