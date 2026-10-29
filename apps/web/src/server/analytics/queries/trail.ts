import "server-only";
import { cache } from "react";
import type { AnalyticsTrailOutcomeRow } from "@/lib/supabase/types";
import { audienceView, type AnalyticsAudience } from "@/server/analytics/audience";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { fetchProdSummary, pickSection } from "@/server/analytics/summary-client";
import { queryError, withAnalyticsTarget } from "./helpers";
import type { PanelData, TrailMetrics, TrailOutcomeMetrics } from "./types";

/** Journeys are open-ended combinations; the busiest ones are the paths worth reading. */
export const MAX_JOURNEYS = 25;

/** Always queries Supabase directly. What GET /api/analytics/summary itself calls. */
export const queryTrailFromDb = cache(
  async (target: AnalyticsTarget, audience: AnalyticsAudience = "prod") =>
    withAnalyticsTarget<AnalyticsTrailOutcomeRow[]>(target, async (db) => {
      const { data, error } = await db
        .from(audienceView(audience, "analytics_trail_outcomes", "analytics_dev_trail_outcomes"))
        .select("*");
      if (error) throw queryError(error.message);
      return data ?? [];
    }),
);

function toOutcome(row: AnalyticsTrailOutcomeRow): TrailOutcomeMetrics {
  return {
    channel: row.channel,
    kind: row.kind,
    people: row.people,
    people30d: row.people_30d,
    downloaded: row.downloaded,
    paired: row.paired,
    trials: row.trials,
    paid: row.paid,
    lifetime: row.lifetime,
    activeTrials: row.active_trials,
    activeSubs: row.active_subs,
  };
}

/**
 * Outcomes first: what's paying now, then what has ever trialed or paid, then reach. That puts
 * the channels worth doubling down on at the top of every layer.
 */
export function byOutcome(a: TrailOutcomeMetrics, b: TrailOutcomeMetrics): number {
  return (
    b.activeSubs + b.lifetime - (a.activeSubs + a.lifetime) ||
    b.activeTrials - a.activeTrials ||
    b.paid + b.trials - (a.paid + a.trials) ||
    b.paired - a.paired ||
    b.people - a.people ||
    a.channel.localeCompare(b.channel)
  );
}

export function toTrailMetrics(rows: AnalyticsTrailOutcomeRow[]): TrailMetrics {
  const layer = (name: AnalyticsTrailOutcomeRow["layer"]) =>
    rows.filter((row) => row.layer === name).map(toOutcome).sort(byOutcome);
  return {
    sources: layer("source"),
    blog: layer("blog"),
    affiliates: layer("affiliate"),
    journeys: layer("journey")
      .sort((a, b) => b.people - a.people || byOutcome(a, b))
      .slice(0, MAX_JOURNEYS),
  };
}

/** Marketing metrics use the deployed summary API; the internal audience reads its production DB views directly. */
export const queryTrail = cache(
  async (
    target: AnalyticsTarget,
    audience: AnalyticsAudience = "prod",
  ): Promise<PanelData<TrailMetrics>> => {
    if (target === "prod" && audience === "prod") {
      return pickSection(await fetchProdSummary(), (s) => s.trail);
    }
    const result = await queryTrailFromDb(target, audience);
    return result.ok ? { ok: true, rows: toTrailMetrics(result.rows) } : result;
  },
);
