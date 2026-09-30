import { NextRequest, NextResponse } from "next/server";
import { UnauthorizedError, requireBearerUser } from "@/lib/auth/require-bearer-user";
import {
  ACTIVE_BODY_LIMIT,
  parseActiveBody,
  rateLimitAnalytics,
  readJsonBody,
} from "@/server/analytics/ingest";
import { reportActiveDay } from "@/server/analytics/track";

export const runtime = "nodejs";

// Once-per-UTC-day DAU ping: `protected` from the privileged service (no account, so never a
// bearer), `ui` from the desktop app (bearer optional, used only to link device to account).
export async function POST(request: NextRequest) {
  const body = await readJsonBody(request, ACTIVE_BODY_LIMIT);
  if (!body.ok) return NextResponse.json({ error: body.message }, { status: body.status });
  const parsed = parseActiveBody(body.value);
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

  await reportActiveDay({ deviceId: parsed.deviceId, userId, kind: parsed.kind });
  return new NextResponse(null, { status: 202 });
}
