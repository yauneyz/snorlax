import { NextRequest, NextResponse } from "next/server";
import { DEVICE_HEADERS } from "@talysman/product";
import { requireBearerUser, UnauthorizedError } from "@/lib/auth/require-bearer-user";
import { captureException } from "@/lib/sentry";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rateLimitAnalytics } from "@/server/analytics/ingest";
import { messagesForDevice, parseDeviceId } from "@/server/app-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Messages for the desktop app. Keyed by the device-id header so anonymous installs are
 * reachable; a bearer token adds the account's messages. The app calls this before it touches
 * the daemon, so it works even when startup fails.
 */
export async function GET(request: NextRequest) {
  const deviceId = parseDeviceId(request.headers.get(DEVICE_HEADERS.id));
  if (!deviceId) return NextResponse.json({ error: "missing device id" }, { status: 400 });
  if (!rateLimitAnalytics(request, deviceId)) {
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  }

  // Best effort: an expired session must not cost the user their device's messages, which may
  // be exactly the ones telling them how to recover.
  let userId: string | null = null;
  if (request.headers.has("authorization")) {
    try {
      userId = (await requireBearerUser(request)).id;
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) throw error;
    }
  }

  try {
    const messages = await messagesForDevice(supabaseAdmin(), deviceId, userId);
    return NextResponse.json(messages, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    await captureException(error, { route: "desktop/messages" });
    return NextResponse.json({ error: "Unable to load messages" }, { status: 500 });
  }
}
