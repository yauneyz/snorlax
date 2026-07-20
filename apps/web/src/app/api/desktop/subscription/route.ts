import { NextRequest, NextResponse } from "next/server";
import { requireBearerUser, UnauthorizedError } from "@/lib/auth/require-bearer-user";
import { captureException } from "@/lib/sentry";
import { getSubscriptionDetailForUser } from "@/lib/stripe/subscription";

export async function GET(request: NextRequest) {
  try {
    const user = await requireBearerUser(request);
    const detail = await getSubscriptionDetailForUser(user.id);
    return NextResponse.json(detail);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    await captureException(err, { route: "desktop/subscription" });
    return NextResponse.json({ error: "Could not load subscription" }, { status: 500 });
  }
}
