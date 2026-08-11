import "server-only";
import { cache } from "react";
import type { AnalyticsEventRow, AnalyticsUsageDailyRow } from "@/lib/supabase/types";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryError, withAnalyticsTarget } from "./helpers";

export type RawStream = { events: AnalyticsEventRow[]; usage: AnalyticsUsageDailyRow[] };

export const queryRawStream = cache(async (target: AnalyticsTarget) =>
  withAnalyticsTarget<RawStream>(target, async (db) => {
    const [events, usage] = await Promise.all([
      db.from("analytics_events").select("*").order("received_at", { ascending: false }).limit(200),
      db
        .from("analytics_usage_daily")
        .select("*")
        .order("reported_at", { ascending: false })
        .limit(50),
    ]);
    if (events.error) throw queryError(events.error.message);
    if (usage.error) throw queryError(usage.error.message);
    return { events: events.data ?? [], usage: usage.data ?? [] };
  }),
);
