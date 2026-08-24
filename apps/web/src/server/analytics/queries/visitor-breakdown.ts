import "server-only";
import { cache } from "react";
import type { AnalyticsVisitorBreakdownRow } from "@/lib/supabase/types";
import { audienceView, type AnalyticsAudience } from "@/server/analytics/audience";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { fetchProdSummary, pickSection } from "@/server/analytics/summary-client";
import { queryError, withAnalyticsTarget } from "./helpers";
import type { PanelData, VisitorBreakdownMetric, VisitorBreakdownMetrics } from "./types";

export const queryVisitorBreakdownFromDb = cache(
  async (target: AnalyticsTarget, audience: AnalyticsAudience = "prod") =>
    withAnalyticsTarget<AnalyticsVisitorBreakdownRow[]>(target, async (db) => {
      const { data, error } = await db
        .from(
          audienceView(audience, "analytics_visitor_breakdown", "analytics_dev_visitor_breakdown"),
        )
        .select("*")
        .order("visitors", { ascending: false });
      if (error) throw queryError(error.message);
      return data ?? [];
    }),
);

function metricsFor(
  rows: AnalyticsVisitorBreakdownRow[],
  dimension: AnalyticsVisitorBreakdownRow["dimension"],
): VisitorBreakdownMetric[] {
  const matching = rows.filter((row) => row.dimension === dimension);
  const total = matching.reduce((sum, row) => sum + row.visitors, 0);
  return matching.map((row) => ({
    label: row.value,
    visitors: row.visitors,
    pctVisitors: total > 0 ? Math.round((1000 * row.visitors) / total) / 10 : 0,
  }));
}

export function toVisitorBreakdownMetrics(
  rows: AnalyticsVisitorBreakdownRow[],
): VisitorBreakdownMetrics {
  return {
    deviceTypes: metricsFor(rows, "device_type"),
    operatingSystems: metricsFor(rows, "os"),
  };
}

export const queryVisitorBreakdown = cache(
  async (
    target: AnalyticsTarget,
    audience: AnalyticsAudience = "prod",
  ): Promise<PanelData<VisitorBreakdownMetrics>> => {
    if (target === "prod" && audience === "prod") {
      return pickSection(await fetchProdSummary(), (summary) => summary.visitorBreakdown);
    }
    const result = await queryVisitorBreakdownFromDb(target, audience);
    return result.ok ? { ok: true, rows: toVisitorBreakdownMetrics(result.rows) } : result;
  },
);
