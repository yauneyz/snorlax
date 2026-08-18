import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { captureException } from "@/lib/sentry";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hasValidInsightsBearer } from "@/server/insights/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const registrationSchema = z.object({
  token: z.string().trim().min(20).max(4096),
  platform: z.literal("android"),
});

export async function POST(request: NextRequest) {
  if (!hasValidInsightsBearer(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = registrationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid registration" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin().from("insights_push_devices").upsert(
    {
      token: parsed.data.token,
      platform: parsed.data.platform,
      enabled: true,
      updated_at: now,
    },
    { onConflict: "token" },
  );
  if (error) {
    await captureException(error, { where: "insights.notifications.register" });
    return NextResponse.json({ error: "registration failed" }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
