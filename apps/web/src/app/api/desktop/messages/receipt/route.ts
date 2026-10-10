import { NextRequest, NextResponse } from "next/server";
import { DEVICE_HEADERS, appMessageReceiptSchema } from "@talysman/product";
import { captureException } from "@/lib/sentry";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rateLimitAnalytics } from "@/server/analytics/ingest";
import { parseDeviceId, recordReceipt } from "@/server/app-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Delivery tracking for app messages: lets the sender see a message landed, and stops a
 *  dismissed one from being served to this device again. */
export async function POST(request: NextRequest) {
  const deviceId = parseDeviceId(request.headers.get(DEVICE_HEADERS.id));
  if (!deviceId) return NextResponse.json({ error: "missing device id" }, { status: 400 });
  if (!rateLimitAnalytics(request, deviceId)) {
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  }

  const parsed = appMessageReceiptSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid receipt" }, { status: 400 });

  try {
    await recordReceipt(supabaseAdmin(), deviceId, parsed.data);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    await captureException(error, { route: "desktop/messages/receipt" });
    return NextResponse.json({ error: "Unable to record receipt" }, { status: 500 });
  }
}
