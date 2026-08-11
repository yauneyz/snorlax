import "server-only";
import { cache } from "react";
import type { AnalyticsChannelFunnelRow } from "@/lib/supabase/types";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryError, withAnalyticsTarget } from "./helpers";

export const queryChannels = cache(async (target: AnalyticsTarget) =>
  withAnalyticsTarget<AnalyticsChannelFunnelRow[]>(target, async (db) => {
    const { data, error } = await db
      .from("analytics_channel_funnel")
      .select("*")
      .order("visitors", { ascending: false });
    if (error) throw queryError(error.message);
    return data ?? [];
  }),
);
