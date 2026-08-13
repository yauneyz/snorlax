import "server-only";
import { cache } from "react";
import type { AnalyticsFunnelSummaryRow } from "@/lib/supabase/types";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { fetchProdSummary, pickSection } from "@/server/analytics/summary-client";
import { queryError, withAnalyticsTarget } from "./helpers";
import type { FunnelMetrics, PanelData } from "./types";

/**
 * Always queries Supabase directly, regardless of target. This is what GET
 * /api/analytics/summary itself calls — `queryFunnel` below must never be used for the "prod"
 * target from that route, or it would fetch itself.
 */
export const queryFunnelFromDb = cache(async (target: AnalyticsTarget) =>
  withAnalyticsTarget<AnalyticsFunnelSummaryRow | null>(target, async (db) => {
    const { data, error } = await db.from("analytics_funnel_summary").select("*").maybeSingle();
    if (error) throw queryError(error.message);
    return data;
  }),
);

function toMetrics(row: AnalyticsFunnelSummaryRow): FunnelMetrics {
  return {
    visitors: row.visitors,
    downloaded: row.downloaded,
    installed: row.installed,
    accounts: row.accounts,
    paired: row.paired,
    activated: row.activated,
    trials: row.trials,
    paid: row.paid,
    medianVisitToDownloadSeconds: row.median_visit_to_download_seconds,
    medianInstallToValueSeconds: row.median_install_to_value_seconds,
  };
}

/** Used by the /insights dashboard: prod reads through the deployed summary API (analytics-arch.md §12.4), dev reads Supabase directly. */
export const queryFunnel = cache(
  async (target: AnalyticsTarget): Promise<PanelData<FunnelMetrics | null>> => {
    if (target === "prod") return pickSection(await fetchProdSummary(), (s) => s.funnel);
    const result = await queryFunnelFromDb(target);
    return result.ok ? { ok: true, rows: result.rows ? toMetrics(result.rows) : null } : result;
  },
);
