import "server-only";
import { cache } from "react";
import { config } from "@/lib/config";
import type {
  ActiveUsersMetrics,
  ChannelMetrics,
  EngagementMetrics,
  FunnelMetrics,
  InstallHealthMetrics,
  PanelData,
  RetentionCohortMetrics,
  RevenueMetrics,
  VisitorBreakdownMetrics,
} from "./queries/types";

// The exact JSON shape GET /api/analytics/summary returns (apps/web/src/app/api/analytics/summary/route.ts).
interface Section<T> {
  ok: boolean;
  data?: T;
  message?: string;
}
interface WidgetSummary {
  generatedAt: string;
  funnel: Section<FunnelMetrics | null>;
  activeUsers: Section<ActiveUsersMetrics | null>;
  engagement: Section<EngagementMetrics | null>;
  revenue: Section<RevenueMetrics | null>;
  retention: Section<RetentionCohortMetrics[]>;
  installHealth: Section<InstallHealthMetrics>;
  channels: Section<ChannelMetrics[]>;
  visitorBreakdown: Section<VisitorBreakdownMetrics>;
}

type FetchResult = { ok: true; summary: WidgetSummary } | { ok: false; message: string };

/**
 * /insights (prod target) reads through the same deployed, bearer-token-gated endpoint the
 * Android widget uses (analytics-arch.md §12.4) instead of holding a Supabase client of its
 * own — one fewer place ANALYTICS_PROD_SUPABASE_SECRET_KEY needs to exist. `cache()` means the
 * six query functions that call this during one render share a single HTTP round trip.
 */
export const fetchProdSummary = cache(async (): Promise<FetchResult> => {
  if (!config.insights.widgetApiKey) {
    return {
      ok: false,
      message: "INSIGHTS_WIDGET_API_KEY is not configured locally. Run pnpm sync:env.",
    };
  }
  try {
    const res = await fetch(`${config.insights.apiBaseUrl}/api/analytics/summary`, {
      headers: { Authorization: `Bearer ${config.insights.widgetApiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) {
      return { ok: false, message: `Widget API responded ${res.status}` };
    }
    return { ok: true, summary: (await res.json()) as WidgetSummary };
  } catch (error) {
    return {
      ok: false,
      message: `Widget API is unreachable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
});

/** Extracts one section of a fetched summary into the same PanelData<T> shape the dev-target Supabase queries use. */
export function pickSection<T>(
  result: FetchResult,
  pick: (summary: WidgetSummary) => Section<T>,
): PanelData<T> {
  if (!result.ok) return { ok: false, message: result.message };
  const section = pick(result.summary);
  if (!section)
    return {
      ok: false,
      message: "Summary section is unavailable. Deploy the latest analytics API.",
    };
  if (!section.ok) return { ok: false, message: section.message ?? "Unavailable." };
  return { ok: true, rows: section.data as T };
}
