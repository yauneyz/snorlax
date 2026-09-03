import "server-only";
import { cache } from "react";
import { audienceView, type AnalyticsAudience } from "@/server/analytics/audience";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryError, withAnalyticsTarget } from "./helpers";

export interface PmfMetrics {
  responses: number;
  /** The actual PMF number: % of respondents who answered "very disappointed" (Sean Ellis's
   * classic 40% threshold). Null when there are no responses yet. */
  pctVeryDisappointed: number | null;
  pctSomewhatDisappointed: number | null;
  pctNotDisappointed: number | null;
}

const EMPTY: PmfMetrics = {
  responses: 0,
  pctVeryDisappointed: null,
  pctSomewhatDisappointed: null,
  pctNotDisappointed: null,
};

/**
 * Reads `pmf_survey_responded` rows straight off the resolved events view rather than a
 * dedicated SQL view — response volume is low (one row per person per ~90 days) so this never
 * needs to be indexed/materialized the way the high-volume funnel/revenue panels are.
 */
export const queryPmf = cache(
  async (target: AnalyticsTarget, audience: AnalyticsAudience = "prod") =>
    withAnalyticsTarget<PmfMetrics>(target, async (db) => {
      const { data, error } = await db
        .from(audienceView(audience, "analytics_events_resolved", "analytics_dev_events_resolved"))
        .select("props")
        .eq("event", "pmf_survey_responded");
      if (error) throw queryError(error.message);
      const rows = data ?? [];
      if (rows.length === 0) return EMPTY;

      const counts = { very: 0, somewhat: 0, not: 0 };
      for (const row of rows) {
        const disappointment = (row.props as { disappointment?: string } | null)?.disappointment;
        if (disappointment === "very" || disappointment === "somewhat" || disappointment === "not") {
          counts[disappointment] += 1;
        }
      }
      const total = rows.length;
      return {
        responses: total,
        pctVeryDisappointed: Math.round((counts.very / total) * 100),
        pctSomewhatDisappointed: Math.round((counts.somewhat / total) * 100),
        pctNotDisappointed: Math.round((counts.not / total) * 100),
      };
    }),
);
