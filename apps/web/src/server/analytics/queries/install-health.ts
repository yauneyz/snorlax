import "server-only";
import { cache } from "react";
import type { AnalyticsInstallHealthRow } from "@/lib/supabase/types";
import { audienceView, type AnalyticsAudience } from "@/server/analytics/audience";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { fetchProdSummary, pickSection } from "@/server/analytics/summary-client";
import { queryError, withAnalyticsTarget } from "./helpers";
import type { InstallHealthMetrics, PanelData } from "./types";

/** Always queries Supabase directly. What GET /api/analytics/summary itself calls. */
export const queryInstallHealthFromDb = cache(
  async (target: AnalyticsTarget, audience: AnalyticsAudience = "prod") =>
    withAnalyticsTarget<AnalyticsInstallHealthRow[]>(target, async (db) => {
      const { data, error } = await db
        .from(audienceView(audience, "analytics_install_health", "analytics_dev_install_health"))
        .select("*");
      if (error) throw queryError(error.message);
      return data ?? [];
    }),
);

function toMetrics(rows: AnalyticsInstallHealthRow[]): InstallHealthMetrics {
  return {
    platforms: rows
      .filter((row) => row.failure_reason === null)
      .map((row) => ({
        platform: row.platform,
        appInstalled: row.app_installed,
        serviceInstalled: row.service_installed,
        extensionConnected: row.extension_connected,
      })),
    failures: rows
      .filter((row) => row.failure_reason !== null)
      .map((row) => ({
        platform: row.platform,
        reason: row.failure_reason as string,
        count: row.install_failed,
      })),
  };
}

/** Marketing metrics use the deployed summary API; the internal audience reads its production DB view directly. */
export const queryInstallHealth = cache(
  async (
    target: AnalyticsTarget,
    audience: AnalyticsAudience = "prod",
  ): Promise<PanelData<InstallHealthMetrics>> => {
    if (target === "prod" && audience === "prod") {
      return pickSection(await fetchProdSummary(), (s) => s.installHealth);
    }
    const result = await queryInstallHealthFromDb(target, audience);
    return result.ok ? { ok: true, rows: toMetrics(result.rows) } : result;
  },
);
