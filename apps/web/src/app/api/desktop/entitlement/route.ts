import { NextRequest, NextResponse } from "next/server";
import { DEVICE_HEADERS, entitlementSchema } from "@talysman/product";
import { applyDeviceLimit, getUserEntitlement, type EntitledDevice } from "@talysman/billing-server";
import { requireBearerUser, UnauthorizedError } from "@/lib/auth/require-bearer-user";
import { captureException } from "@/lib/sentry";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Header value trimmed and capped, or undefined when absent/empty. */
function header(request: NextRequest, name: string, max: number): string | undefined {
  const value = request.headers.get(name)?.trim();
  return value ? value.slice(0, max) : undefined;
}

/**
 * The computer making the request. Builds from before the device limit don't send one; they
 * keep getting the account's entitlement unlimited until they update.
 */
function requestDevice(request: NextRequest): EntitledDevice | undefined {
  const deviceId = header(request, DEVICE_HEADERS.id, 128);
  if (!deviceId) return undefined;
  return {
    deviceId,
    name: header(request, DEVICE_HEADERS.name, 200),
    platform: header(request, DEVICE_HEADERS.platform, 32),
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireBearerUser(request);
    const db = supabaseAdmin();
    let entitlement = await getUserEntitlement({ db, userId: user.id });
    const device = requestDevice(request);
    if (device) {
      entitlement = await applyDeviceLimit({ db, userId: user.id, entitlement, device });
    }
    return NextResponse.json(entitlementSchema.parse(entitlement));
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    await captureException(err, { route: "desktop/entitlement" });
    return NextResponse.json({ error: "Unable to load entitlement" }, { status: 500 });
  }
}
