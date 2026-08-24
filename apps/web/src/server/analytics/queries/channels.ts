import "server-only";
import { cache } from "react";
import type { AnalyticsChannelFunnelRow } from "@/lib/supabase/types";
import { audienceView, type AnalyticsAudience } from "@/server/analytics/audience";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { fetchProdSummary, pickSection } from "@/server/analytics/summary-client";
import { queryError, withAnalyticsTarget } from "./helpers";
import type { ChannelMetrics, PanelData } from "./types";

/** Always queries Supabase directly. What GET /api/analytics/summary itself calls. */
export const queryChannelsFromDb = cache(
  async (target: AnalyticsTarget, audience: AnalyticsAudience = "prod") =>
    withAnalyticsTarget<AnalyticsChannelFunnelRow[]>(target, async (db) => {
      const { data, error } = await db
        .from(audienceView(audience, "analytics_channel_funnel", "analytics_dev_channel_funnel"))
        .select("*")
        .order("visitors", { ascending: false });
      if (error) throw queryError(error.message);
      return data ?? [];
    }),
);

function toMetrics(rows: AnalyticsChannelFunnelRow[]): ChannelMetrics[] {
  return rows.map((row) => ({
    channel: row.channel,
    medium: row.medium,
    visitors: row.visitors,
    downloaded: row.downloaded,
    installed: row.installed,
    accounts: row.accounts,
    trials: row.trials,
    paid: row.paid,
    pctVisitorToPaid: row.pct_visitor_to_paid ?? 0,
  }));
}

/** Marketing metrics use the deployed summary API; the internal audience reads its production DB views directly. */
export const queryChannels = cache(
  async (
    target: AnalyticsTarget,
    audience: AnalyticsAudience = "prod",
  ): Promise<PanelData<ChannelMetrics[]>> => {
    if (target === "prod" && audience === "prod") {
      return pickSection(await fetchProdSummary(), (s) => s.channels);
    }
    const result = await queryChannelsFromDb(target, audience);
    return result.ok ? { ok: true, rows: toMetrics(result.rows) } : result;
  },
);
