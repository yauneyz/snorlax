import "server-only";
import { cache } from "react";
import type { AnalyticsInstallHealthRow } from "@/lib/supabase/types";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryError, withAnalyticsTarget } from "./helpers";

export const queryInstallHealth = cache(async (target: AnalyticsTarget) =>
  withAnalyticsTarget<AnalyticsInstallHealthRow[]>(target, async (db) => {
    const { data, error } = await db.from("analytics_install_health").select("*");
    if (error) throw queryError(error.message);
    return data ?? [];
  }),
);
