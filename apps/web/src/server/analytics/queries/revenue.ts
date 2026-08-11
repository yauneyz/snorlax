import "server-only";
import { cache } from "react";
import type { AnalyticsRevenueSummaryRow } from "@/lib/supabase/types";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryError, withAnalyticsTarget } from "./helpers";

export const queryRevenue = cache(async (target: AnalyticsTarget) =>
  withAnalyticsTarget<AnalyticsRevenueSummaryRow | null>(target, async (db) => {
    const { data, error } = await db.from("analytics_revenue_summary").select("*").maybeSingle();
    if (error) throw queryError(error.message);
    return data;
  }),
);
