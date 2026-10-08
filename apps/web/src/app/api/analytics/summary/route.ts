import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { queryChannelsFromDb } from "@/server/analytics/queries/channels";
import {
  queryActiveUsersFromDb,
  queryEngagementFromDb,
  toActiveUsers,
  toEngagement,
} from "@/server/analytics/queries/engagement";
import { queryFunnelFromDb } from "@/server/analytics/queries/funnel";
import { retentionPct } from "@/server/analytics/queries/helpers";
import { queryInstallHealthFromDb } from "@/server/analytics/queries/install-health";
import { queryLandingPagesFromDb, toLandingPageMetrics } from "@/server/analytics/queries/landing-pages";
import { queryPmf } from "@/server/analytics/queries/pmf";
import { queryRetentionFromDb } from "@/server/analytics/queries/retention";
import { queryRevenueFromDb } from "@/server/analytics/queries/revenue";
import {
  queryVisitorBreakdownFromDb,
  toVisitorBreakdownMetrics,
} from "@/server/analytics/queries/visitor-breakdown";
import type { PanelData } from "@/server/analytics/queries/types";
import { hasValidInsightsBearer } from "@/server/insights/auth";

// Unlike /insights (analytics-arch.md §12.2, deliberately dev-only), this route is meant to
// be reachable from a deployed environment: it's the feed for the Android widget. It trades
// the dashboard's service-role Supabase client for a single-purpose bearer token
// (INSIGHTS_WIDGET_API_KEY) so the mobile app never holds DB-level credentials.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function section<T, U>(
  result: PanelData<T>,
  map: (rows: T) => U,
): { ok: true; data: U } | { ok: false; message: string } {
  return result.ok ? { ok: true, data: map(result.rows) } : { ok: false, message: result.message };
}

export async function GET(request: NextRequest) {
  const expected = config.insights.widgetApiKey;
  if (!expected) {
    return NextResponse.json({ error: "widget endpoint not configured" }, { status: 503 });
  }

  if (!hasValidInsightsBearer(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Always the raw *FromDb queries — never the branching queryX() used by /insights, which
  // for target="prod" would call back into this very route.
  const target = "prod" as const;
  const [
    funnel,
    activeUsers,
    engagement,
    revenue,
    retention,
    installHealth,
    channels,
    visitorBreakdown,
    landingPages,
    pmf,
  ] = await Promise.all([
    queryFunnelFromDb(target),
    queryActiveUsersFromDb(target),
    queryEngagementFromDb(target),
    queryRevenueFromDb(target),
    queryRetentionFromDb(target),
    queryInstallHealthFromDb(target),
    queryChannelsFromDb(target),
    queryVisitorBreakdownFromDb(target),
    queryLandingPagesFromDb(target),
    queryPmf(target),
  ]);

  const body = {
    generatedAt: new Date().toISOString(),

    funnel: section(funnel, (row) =>
      row
        ? {
            visitors: row.visitors,
            downloaded: row.downloaded,
            installed: row.installed,
            accounts: row.accounts,
            paired: row.paired,
            activated: row.activated,
            trials: row.trials,
            paid: row.paid,
            medianVisitToDownloadSeconds: row.median_visit_to_download_seconds,
            medianInstallToValueSeconds: row.median_install_to_value_seconds,
          }
        : null,
    ),

    activeUsers: section(activeUsers, toActiveUsers),

    engagement: section(engagement, toEngagement),

    revenue: section(revenue, (row) =>
      row
        ? {
            activeSubscriptions: row.active_subscriptions,
            activeTrials: row.active_trials,
            subscriptionsStarted: row.subscriptions_started,
            cancelIntents: row.cancel_intents,
            subscriptionsEnded: row.subscriptions_ended,
            paymentsFailed: row.payments_failed,
            refunds: row.refunds,
          }
        : null,
    ),

    retention: section(retention, (rows) =>
      rows.slice(0, 12).map((row) => ({
        cohortWeek: row.cohort_week,
        devices: row.devices,
        d1Pct: retentionPct(row.d1_protected, row.eligible_d1),
        d7Pct: retentionPct(row.d7_protected, row.eligible_d7),
        d30Pct: retentionPct(row.d30_protected, row.eligible_d30),
      })),
    ),

    installHealth: section(installHealth, (rows) => ({
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
    })),

    channels: section(channels, (rows) =>
      rows.slice(0, 10).map((row) => ({
        channel: row.channel,
        medium: row.medium,
        visitors: row.visitors,
        downloaded: row.downloaded,
        installed: row.installed,
        accounts: row.accounts,
        trials: row.trials,
        paid: row.paid,
        pctVisitorToPaid: row.pct_visitor_to_paid ?? 0,
      })),
    ),

    visitorBreakdown: section(visitorBreakdown, toVisitorBreakdownMetrics),

    landingPages: section(landingPages, toLandingPageMetrics),

    // New top-level section (added alongside the PMF survey). The widget's Kotlin JSON parser
    // uses `ignoreUnknownKeys = true`, so this is safe to add without touching widget code —
    // only the full Insights app screen reads it.
    pmf: section(pmf, (row) => row),
  };

  return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
