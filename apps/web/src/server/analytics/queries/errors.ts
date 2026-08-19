import "server-only";
import { cache } from "react";
import { config } from "@/lib/config";
import { USER_FACING_ERROR_EVENTS } from "@/lib/analytics/events";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryError, withAnalyticsTarget } from "./helpers";
import type { PanelData } from "./types";

export interface ErrorReport {
  event: string;
  platform: string | null;
  appVersion: string | null;
  deviceId: string | null;
  occurredAt: string;
  receivedAt: string;
  message: string;
  stack: string | null;
}

const MAX_ERRORS = 200;

function toReport(row: {
  event: string;
  platform: string | null;
  app_version: string | null;
  device_id: string | null;
  occurred_at: string;
  received_at: string;
  props: Record<string, unknown> | null;
}): ErrorReport {
  const props = row.props ?? {};
  return {
    event: row.event,
    platform: row.platform,
    appVersion: row.app_version,
    deviceId: row.device_id,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    message: typeof props.message === "string" ? props.message : row.event,
    stack: typeof props.stack === "string" ? props.stack : null,
  };
}

/** Always queries Supabase directly. What GET /api/analytics/errors itself calls. */
export const queryRecentErrorsFromDb = cache(async (target: AnalyticsTarget) =>
  withAnalyticsTarget<ErrorReport[]>(target, async (db) => {
    const { data, error } = await db
      .from("analytics_events")
      .select("event, platform, app_version, device_id, occurred_at, received_at, props")
      .in("event", [...USER_FACING_ERROR_EVENTS])
      .order("received_at", { ascending: false })
      .limit(MAX_ERRORS);
    if (error) throw queryError(error.message);
    return (data ?? []).map(toReport);
  }),
);

/**
 * Prod reads through the same deployed, bearer-token-gated route the Android errors screen
 * uses (mirrors summary-client.ts's fetchProdSummary) instead of holding a second Supabase
 * client for it; dev reads local Supabase directly.
 */
const fetchProdErrors = cache(async (): Promise<PanelData<ErrorReport[]>> => {
  if (!config.insights.widgetApiKey) {
    return { ok: false, message: "INSIGHTS_WIDGET_API_KEY is not configured locally. Run pnpm sync:env." };
  }
  try {
    const res = await fetch(`${config.insights.apiBaseUrl}/api/analytics/errors`, {
      headers: { Authorization: `Bearer ${config.insights.widgetApiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return { ok: false, message: `Errors API responded ${res.status}` };
    return { ok: true, rows: (await res.json()) as ErrorReport[] };
  } catch (error) {
    return {
      ok: false,
      message: `Errors API is unreachable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
});

/** Used by the /insights dashboard: prod reads through the deployed errors API, dev reads Supabase directly. */
export const queryRecentErrors = cache(
  async (target: AnalyticsTarget): Promise<PanelData<ErrorReport[]>> => {
    if (target === "prod") return fetchProdErrors();
    return queryRecentErrorsFromDb(target);
  },
);
