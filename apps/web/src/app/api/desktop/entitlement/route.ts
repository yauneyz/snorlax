import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { entitlementSchema } from "@talysman/product";
import { getUserEntitlement } from "@talysman/billing-server";
import { requireBearerUser, UnauthorizedError } from "@/lib/auth/require-bearer-user";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const user = await requireBearerUser(request);
    const entitlement = await getUserEntitlement({
      db: supabaseAdmin(),
      userId: user.id,
    });
    return NextResponse.json(entitlementSchema.parse(entitlement));
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    Sentry.captureException(err, { extra: { route: "desktop/entitlement" } });
    return NextResponse.json({ error: "Unable to load entitlement" }, { status: 500 });
  }
}
