import "server-only";
import { cache } from "react";
import type { AnalyticsBlogPostRow } from "@/lib/supabase/types";
import { audienceView, type AnalyticsAudience } from "@/server/analytics/audience";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { fetchProdSummary, pickSection } from "@/server/analytics/summary-client";
import { queryError, withAnalyticsTarget } from "./helpers";
import type { BlogPostMetrics, PanelData } from "./types";

/** Always queries Supabase directly. What GET /api/analytics/summary itself calls. */
export const queryBlogPostsFromDb = cache(
  async (target: AnalyticsTarget, audience: AnalyticsAudience = "prod") =>
    withAnalyticsTarget<AnalyticsBlogPostRow[]>(target, async (db) => {
      const { data, error } = await db
        .from(audienceView(audience, "analytics_blog_posts", "analytics_dev_blog_posts"))
        .select("*")
        .order("views", { ascending: false });
      if (error) throw queryError(error.message);
      return data ?? [];
    }),
);

export function toBlogPostMetrics(rows: AnalyticsBlogPostRow[]): BlogPostMetrics[] {
  return rows.map((row) => ({
    slug: row.slug,
    views: row.views,
    views7d: row.views_7d,
    visitors: row.visitors,
    entrances: row.entrances,
    ctaClickers: row.cta_clickers,
    attributed: row.attributed,
    downloaded: row.downloaded,
    installed: row.installed,
    paired: row.paired,
    activated: row.activated,
    trials: row.trials,
    paid: row.paid,
    linked: row.linked,
    linkedDownloaded: row.linked_downloaded,
    linkedPaired: row.linked_paired,
    linkedTrials: row.linked_trials,
    linkedPaid: row.linked_paid,
  }));
}

/** Marketing metrics use the deployed summary API; the internal audience reads its production DB views directly. */
export const queryBlogPosts = cache(
  async (
    target: AnalyticsTarget,
    audience: AnalyticsAudience = "prod",
  ): Promise<PanelData<BlogPostMetrics[]>> => {
    if (target === "prod" && audience === "prod") {
      return pickSection(await fetchProdSummary(), (s) => s.blogPosts);
    }
    const result = await queryBlogPostsFromDb(target, audience);
    return result.ok ? { ok: true, rows: toBlogPostMetrics(result.rows) } : result;
  },
);
