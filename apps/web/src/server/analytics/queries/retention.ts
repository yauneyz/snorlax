import "server-only";
import { cache } from "react";
import type { AnalyticsRetentionCohortRow } from "@/lib/supabase/types";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryError, withAnalyticsTarget } from "./helpers";

export const queryRetention = cache(async (target: AnalyticsTarget) =>
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
