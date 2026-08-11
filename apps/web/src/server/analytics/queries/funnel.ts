import "server-only";
import { cache } from "react";
import type { AnalyticsFunnelSummaryRow } from "@/lib/supabase/types";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryError, withAnalyticsTarget } from "./helpers";

export const queryFunnel = cache(async (target: AnalyticsTarget) =>
  withAnalyticsTarget<AnalyticsFunnelSummaryRow | null>(target, async (db) => {
    const { data, error } = await db.from("analytics_funnel_summary").select("*").maybeSingle();
    if (error) throw queryError(error.message);
    return data;
  }),
);
