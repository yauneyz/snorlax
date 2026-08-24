import "server-only";
import { cache } from "react";
import { analyticsDb, type AnalyticsTarget } from "@/server/analytics/db";
import type { PanelData } from "./types";

const EXPECTED_ANALYTICS_TABLES = [
  "analytics_persons",
  "analytics_identities",
  "analytics_events",
  "analytics_usage_daily",
  "analytics_ignored_users",
  "analytics_ignored_persons",
] as const;

const EXPECTED_ANALYTICS_VIEWS = [
  "analytics_events_resolved",
  "analytics_usage_resolved",
  "analytics_funnel",
  "analytics_dau",
  "analytics_channel_funnel",
  "analytics_visitor_breakdown",
  "analytics_funnel_summary",
  "analytics_engagement_daily",
  "analytics_retention_cohorts",
  "analytics_install_health",
  "analytics_revenue_summary",
  "analytics_dev_events_resolved",
  "analytics_dev_usage_resolved",
  "analytics_dev_funnel",
  "analytics_dev_dau",
  "analytics_dev_channel_funnel",
  "analytics_dev_visitor_breakdown",
  "analytics_dev_funnel_summary",
  "analytics_dev_engagement_daily",
  "analytics_dev_retention_cohorts",
  "analytics_dev_install_health",
  "analytics_dev_revenue_summary",
] as const;

export const EXPECTED_ANALYTICS_RELATIONS = [
  ...EXPECTED_ANALYTICS_TABLES,
  ...EXPECTED_ANALYTICS_VIEWS,
] as const;

export type RelationState = { relation: string; present: boolean; detail?: string };

export const queryMigrationState = cache(
  async (target: AnalyticsTarget): Promise<PanelData<RelationState[]>> => {
    const db = analyticsDb(target);
    if (!db) return { ok: false, message: "Analytics credentials are not configured." };
    try {
      const tableRows = await Promise.all(
        EXPECTED_ANALYTICS_TABLES.map(async (relation) => {
          const { error } = await db.from(relation).select("*", { head: true, count: "exact" });
          return {
            relation,
            present: !error,
            ...(error ? { detail: error.message } : {}),
          };
        }),
      );
      const viewRows = await Promise.all(
        EXPECTED_ANALYTICS_VIEWS.map(async (relation) => {
          const { error } = await db.from(relation).select("*", { head: true, count: "exact" });
          return {
            relation,
            present: !error,
            ...(error ? { detail: error.message } : {}),
          };
        }),
      );
      return { ok: true, rows: [...tableRows, ...viewRows] };
    } catch (error) {
      return {
        ok: false,
        message: `Database not running: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
);
