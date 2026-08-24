import { NextRequest, NextResponse } from "next/server";
import { checkBotId } from "botid/server";
import { ANALYTICS_ANON_COOKIE, parseAnonId } from "@/lib/analytics/anon-id";
import { UnauthorizedError, requireBearerUser } from "@/lib/auth/require-bearer-user";
import {
  TRACK_BODY_LIMIT,
  attributionFromRequest,
  classifyUserAgent,
  parseTrackBody,
  rateLimitAnalytics,
  readJsonBody,
} from "@/server/analytics/ingest";
import { track } from "@/server/analytics/track";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await readJsonBody(request, TRACK_BODY_LIMIT);
  if (!body.ok) return NextResponse.json({ error: body.message }, { status: body.status });
  const parsed = parseTrackBody(body.value);
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  if (!rateLimitAnalytics(request, parsed.data.deviceId)) {
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

  const botIdResult = await checkBotId();
  const props = {
    ...parsed.data.props,
    ua_class:
      botIdResult.isBot || classifyUserAgent(request.headers.get("user-agent")) === "bot"
        ? "bot"
        : "human",
  };
  await track({
    event: parsed.data.event,
    source: parsed.data.source,
    anonId: parseAnonId(request.cookies.get(ANALYTICS_ANON_COOKIE)?.value),
    deviceId: parsed.data.deviceId,
    userId,
    occurredAt: parsed.data.occurredAt,
    appVersion: parsed.data.appVersion,
    platform: parsed.data.platform,
    attribution: attributionFromRequest(request, props),
    props,
    idempotencyKey: parsed.data.idempotencyKey,
  });
  return new NextResponse(null, { status: 202 });
}
