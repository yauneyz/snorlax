import { NextRequest, NextResponse } from "next/server";
import { UnauthorizedError, requireBearerUser } from "@/lib/auth/require-bearer-user";
import {
  USAGE_BODY_LIMIT,
  parseUsageBody,
  rateLimitAnalytics,
  readJsonBody,
} from "@/server/analytics/ingest";
import { reportUsage } from "@/server/analytics/track";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await readJsonBody(request, USAGE_BODY_LIMIT);
  if (!body.ok) return NextResponse.json({ error: body.message }, { status: body.status });
  const parsed = parseUsageBody(body.value);
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  if (!rateLimitAnalytics(request, parsed.deviceId)) {
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  }

  let userId: string | null = null;
  if (request.headers.has("authorization")) {
    try {
      userId = (await requireBearerUser(request)).id;
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return NextResponse.json({ error: error.message }, { status: 401 });
      }
      throw error;
    }
  }

  await reportUsage({ deviceId: parsed.deviceId, userId, rows: parsed.rows });
  return new NextResponse(null, { status: 202 });
}
