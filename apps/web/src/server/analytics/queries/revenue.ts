import "server-only";
import { cache } from "react";
import { PRO_PRICE_CENTS } from "@talysman/product";
import { config } from "@/lib/config";
import type { AnalyticsRevenueSummaryRow } from "@/lib/supabase/types";
import { audienceView, type AnalyticsAudience } from "@/server/analytics/audience";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { fetchProdSummary, pickSection } from "@/server/analytics/summary-client";
import { queryError, withAnalyticsTarget } from "./helpers";
import type { PanelData, RevenueMetrics } from "./types";

/** Always queries Supabase directly. What GET /api/analytics/summary itself calls. */
export const queryRevenueFromDb = cache(
  async (target: AnalyticsTarget, audience: AnalyticsAudience = "prod") =>
    withAnalyticsTarget<AnalyticsRevenueSummaryRow | null>(target, async (db) => {
      const { data, error } = await db
        .from(audienceView(audience, "analytics_revenue_summary", "analytics_dev_revenue_summary"))
        .select("*")
        .maybeSingle();
      if (error) throw queryError(error.message);
      return data;
    }),
);

/**
 * MRR at list price from active subscription counts by Stripe price id. A price id this
 * deployment doesn't know (an old price, a hand-made one) adds nothing rather than a guess.
 */
export function mrrCents(
  activeByPrice: Record<string, number> | null | undefined,
  prices: { monthly: string; yearly: string } = {
    monthly: config.stripe.priceMonthly,
    yearly: config.stripe.priceYearly,
  },
): number {
  const count = (id: string) => (id ? (activeByPrice?.[id] ?? 0) : 0);
  return Math.round(
    count(prices.monthly) * PRO_PRICE_CENTS.monthly + (count(prices.yearly) * PRO_PRICE_CENTS.yearly) / 12,
  );
}

export function toRevenueMetrics(row: AnalyticsRevenueSummaryRow): RevenueMetrics {
  return {
    activeSubscriptions: row.active_subscriptions,
    activeTrials: row.active_trials,
    subscriptionsStarted: row.subscriptions_started,
    cancelIntents: row.cancel_intents,
    subscriptionsEnded: row.subscriptions_ended,
    paymentsFailed: row.payments_failed,
    refunds: row.refunds,
    cancelingSubscriptions: row.canceling_subscriptions,
    cancelingTrials: row.canceling_trials,
    lifetimeCustomers: row.lifetime_customers,
    mrrCents: mrrCents(row.active_by_price),
  };
}

/** Marketing metrics use the deployed summary API; the internal audience reads its production DB view directly. */
export const queryRevenue = cache(
  async (
    target: AnalyticsTarget,
    audience: AnalyticsAudience = "prod",
  ): Promise<PanelData<RevenueMetrics | null>> => {
    if (target === "prod" && audience === "prod") {
      return pickSection(await fetchProdSummary(), (s) => s.revenue);
    }
    const result = await queryRevenueFromDb(target, audience);
    return result.ok ? { ok: true, rows: result.rows ? toRevenueMetrics(result.rows) : null } : result;
  },
);
