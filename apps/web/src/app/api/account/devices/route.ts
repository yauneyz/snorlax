import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { captureException } from "@/lib/sentry";
import { supabaseServer } from "@/lib/supabase/server";

const removeSchema = z.object({ deviceId: z.string().min(1).max(128) });

/**
 * Frees one of the account's Pro device slots. Runs as the signed-in user, so the row's RLS
 * policy is what limits this to their own devices. A removed computer that is still in use
 * simply claims a slot again on its next check, if one is free.
 */
export async function DELETE(request: NextRequest) {
  const user = await requireUser();
  const parsed = removeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing device" }, { status: 400 });
  }
  try {
    const supabase = await supabaseServer();
    const { error } = await supabase
      .from("entitled_devices")
      .delete()
      .eq("user_id", user.id)
      .eq("device_id", parsed.data.deviceId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    await captureException(err, { userId: user.id, route: "account/devices" });
    return NextResponse.json({ error: "Could not remove the device" }, { status: 500 });
  }
}
