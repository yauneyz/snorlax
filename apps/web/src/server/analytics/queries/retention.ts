import "server-only";
import { cache } from "react";
import type { AnalyticsRetentionCohortRow } from "@/lib/supabase/types";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { fetchProdSummary, pickSection } from "@/server/analytics/summary-client";
import { queryError, retentionPct, withAnalyticsTarget } from "./helpers";
import type { PanelData, RetentionCohortMetrics } from "./types";

/** Always queries Supabase directly. What GET /api/analytics/summary itself calls. */
export const queryRetentionFromDb = cache(async (target: AnalyticsTarget) =>
  withAnalyticsTarget<AnalyticsRetentionCohortRow[]>(target, async (db) => {
    const { data, error } = await db
      .from("analytics_retention_cohorts")
      .select("*")
      .order("cohort_week", { ascending: false })
      .limit(52);
    if (error) throw queryError(error.message);
    return data ?? [];
  }),
);

function toMetrics(rows: AnalyticsRetentionCohortRow[]): RetentionCohortMetrics[] {
  return rows.map((row) => ({
    cohortWeek: row.cohort_week,
    devices: row.devices,
    d1Pct: retentionPct(row.d1_protected, row.eligible_d1),
    d7Pct: retentionPct(row.d7_protected, row.eligible_d7),
    d30Pct: retentionPct(row.d30_protected, row.eligible_d30),
  }));
}

/** Used by the /insights dashboard: prod reads through the deployed summary API, dev reads Supabase directly. */
export const queryRetention = cache(
  async (target: AnalyticsTarget): Promise<PanelData<RetentionCohortMetrics[]>> => {
    if (target === "prod") return pickSection(await fetchProdSummary(), (s) => s.retention);
    const result = await queryRetentionFromDb(target);
    return result.ok ? { ok: true, rows: toMetrics(result.rows) } : result;
  },
);
