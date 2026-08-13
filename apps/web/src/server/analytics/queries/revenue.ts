import "server-only";
import { cache } from "react";
import type { AnalyticsRevenueSummaryRow } from "@/lib/supabase/types";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { fetchProdSummary, pickSection } from "@/server/analytics/summary-client";
import { queryError, withAnalyticsTarget } from "./helpers";
import type { PanelData, RevenueMetrics } from "./types";

/** Always queries Supabase directly. What GET /api/analytics/summary itself calls. */
export const queryRevenueFromDb = cache(async (target: AnalyticsTarget) =>
  withAnalyticsTarget<AnalyticsRevenueSummaryRow | null>(target, async (db) => {
    const { data, error } = await db.from("analytics_revenue_summary").select("*").maybeSingle();
    if (error) throw queryError(error.message);
    return data;
  }),
);

function toMetrics(row: AnalyticsRevenueSummaryRow): RevenueMetrics {
  return {
    activeSubscriptions: row.active_subscriptions,
    activeTrials: row.active_trials,
    subscriptionsStarted: row.subscriptions_started,
    cancelIntents: row.cancel_intents,
    subscriptionsEnded: row.subscriptions_ended,
    paymentsFailed: row.payments_failed,
    refunds: row.refunds,
  };
}

/** Used by the /insights dashboard: prod reads through the deployed summary API, dev reads Supabase directly. */
export const queryRevenue = cache(
  async (target: AnalyticsTarget): Promise<PanelData<RevenueMetrics | null>> => {
    if (target === "prod") return pickSection(await fetchProdSummary(), (s) => s.revenue);
    const result = await queryRevenueFromDb(target);
    return result.ok ? { ok: true, rows: result.rows ? toMetrics(result.rows) : null } : result;
  },
);
