import "server-only";
import { cache } from "react";
import type { AnalyticsEngagementDailyRow } from "@/lib/supabase/types";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryError, withAnalyticsTarget } from "./helpers";

export const queryEngagement = cache(async (target: AnalyticsTarget) =>
  withAnalyticsTarget<AnalyticsEngagementDailyRow[]>(target, async (db) => {
    const { data, error } = await db
      .from("analytics_engagement_daily")
      .select("*")
      .order("local_date", { ascending: false })
      .limit(90);
    if (error) throw queryError(error.message);
    return data ?? [];
  }),
);
