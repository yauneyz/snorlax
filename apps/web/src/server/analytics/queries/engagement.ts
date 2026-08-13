import "server-only";
import { cache } from "react";
import type { AnalyticsEngagementDailyRow } from "@/lib/supabase/types";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { fetchProdSummary, pickSection } from "@/server/analytics/summary-client";
import { queryError, withAnalyticsTarget } from "./helpers";
import type { ActiveUsersMetrics, EngagementMetrics, EngagementSummary, PanelData } from "./types";

/** Always queries Supabase directly. What GET /api/analytics/summary itself calls. */
export const queryEngagementFromDb = cache(async (target: AnalyticsTarget) =>
  withAnalyticsTarget<AnalyticsEngagementDailyRow[]>(target, async (db) => {
    const { data, error } = await db
      .from("analytics_engagement_daily")
      .select("*")
      .order("local_date", { ascending: false })
      .limit(90);
    if (error) throw queryError(error.message);
    return data ?? [];
  }),
);

function toSummary(rows: AnalyticsEngagementDailyRow[]): EngagementSummary {
  const latest = rows[0];
  if (!latest) return { activeUsers: null, engagement: null };

  const activeUsers: ActiveUsersMetrics = {
    dauProtected: latest.dau_protected,
    dauUi: latest.dau_ui,
    mauProtected: latest.mau_protected,
    installedBase30d: latest.installed_base_30d,
    series: rows
      .slice(0, 14)
      .reverse()
      .map((row) => ({ date: row.local_date, dauProtected: row.dau_protected })),
  };
  const engagement: EngagementMetrics = {
    medianFocusMinutes: latest.median_focus_minutes ?? 0,
    scheduledFocusHours: latest.scheduled_focus_hours ?? 0,
    manualFocusHours: latest.manual_focus_hours ?? 0,
    sessionsCompleted: latest.sessions_completed ?? 0,
    sessionsAborted: latest.sessions_aborted ?? 0,
  };
  return { activeUsers, engagement };
}

/**
 * Used by ActiveUsersPanel and EngagementPanel: prod reads through the deployed summary API,
 * dev reads Supabase directly. `cache()` means both panels share one fetch/query per request.
 */
export const queryEngagement = cache(
  async (target: AnalyticsTarget): Promise<PanelData<EngagementSummary>> => {
    if (target === "prod") {
      const result = await fetchProdSummary();
      if (!result.ok) return { ok: false, message: result.message };
      const activeUsers = pickSection(result, (s) => s.activeUsers);
      const engagement = pickSection(result, (s) => s.engagement);
      if (!activeUsers.ok) return activeUsers;
      if (!engagement.ok) return engagement;
      return { ok: true, rows: { activeUsers: activeUsers.rows, engagement: engagement.rows } };
    }
    const result = await queryEngagementFromDb(target);
    return result.ok ? { ok: true, rows: toSummary(result.rows) } : result;
  },
);
