import "server-only";
import { cache } from "react";
import type { AnalyticsEventRow, AnalyticsUsageDailyRow } from "@/lib/supabase/types";
import { audienceView, type AnalyticsAudience } from "@/server/analytics/audience";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryError, withAnalyticsTarget } from "./helpers";

export type RawStream = { events: AnalyticsEventRow[]; usage: AnalyticsUsageDailyRow[] };

export const queryRawStream = cache(
  async (target: AnalyticsTarget, audience: AnalyticsAudience = "prod") =>
    withAnalyticsTarget<RawStream>(target, async (db) => {
      const [events, usage] = await Promise.all([
        db
          .from(
            audienceView(audience, "analytics_events_resolved", "analytics_dev_events_resolved"),
          )
          .select("*")
          .order("received_at", { ascending: false })
          .limit(200),
        db
          .from(audienceView(audience, "analytics_usage_resolved", "analytics_dev_usage_resolved"))
          .select("*")
          .order("reported_at", { ascending: false })
          .limit(50),
      ]);
      if (events.error) throw queryError(events.error.message);
      if (usage.error) throw queryError(usage.error.message);
      return { events: events.data ?? [], usage: usage.data ?? [] };
    }),
);
