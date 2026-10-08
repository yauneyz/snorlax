import "server-only";
import { cache } from "react";
import type { AnalyticsLandingFunnelRow } from "@/lib/supabase/types";
import { audienceView, type AnalyticsAudience } from "@/server/analytics/audience";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { fetchProdSummary, pickSection } from "@/server/analytics/summary-client";
import { queryError, withAnalyticsTarget } from "./helpers";
import type { LandingPageMetrics, PanelData } from "./types";

/** Always queries Supabase directly. What GET /api/analytics/summary itself calls. */
export const queryLandingPagesFromDb = cache(
  async (target: AnalyticsTarget, audience: AnalyticsAudience = "prod") =>
    withAnalyticsTarget<AnalyticsLandingFunnelRow[]>(target, async (db) => {
      const { data, error } = await db
        .from(audienceView(audience, "analytics_landing_funnel", "analytics_dev_landing_funnel"))
        .select("*")
        .order("visitors", { ascending: false });
      if (error) throw queryError(error.message);
      return data ?? [];
    }),
);

export function toLandingPageMetrics(rows: AnalyticsLandingFunnelRow[]): LandingPageMetrics[] {
  return rows.map((row) => ({
    path: row.landing_path,
    visitors: row.visitors,
    organicVisitors: row.organic_visitors,
    downloaded: row.downloaded,
    installed: row.installed,
    activated: row.activated,
    paid: row.paid,
    ctaDownloads: row.cta_downloads,
  }));
}

/** Marketing metrics use the deployed summary API; the internal audience reads its production DB views directly. */
export const queryLandingPages = cache(
  async (
    target: AnalyticsTarget,
    audience: AnalyticsAudience = "prod",
  ): Promise<PanelData<LandingPageMetrics[]>> => {
    if (target === "prod" && audience === "prod") {
      return pickSection(await fetchProdSummary(), (s) => s.landingPages);
    }
    const result = await queryLandingPagesFromDb(target, audience);
    return result.ok ? { ok: true, rows: toLandingPageMetrics(result.rows) } : result;
  },
);
