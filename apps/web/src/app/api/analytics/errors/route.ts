import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { queryRecentErrorsFromDb } from "@/server/analytics/queries/errors";
import { hasValidInsightsBearer } from "@/server/insights/auth";

// Same pattern as GET /api/analytics/summary: reachable from a deployed environment, gated by
// the widget bearer token so the mobile app never holds DB-level credentials. Full-text
// counterpart to summary's installHealth counts.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!config.insights.widgetApiKey) {
    return NextResponse.json({ error: "widget endpoint not configured" }, { status: 503 });
  }
  if (!hasValidInsightsBearer(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await queryRecentErrorsFromDb("prod");
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 502 });
  }
  return NextResponse.json(result.rows, { headers: { "Cache-Control": "private, no-store" } });
}
