import { NextRequest, NextResponse } from "next/server";
import { requireBearerUser, UnauthorizedError } from "@/lib/auth/require-bearer-user";
import { captureException } from "@/lib/sentry";
import {
  getSubscriptionDetailForUser,
  setSubscriptionCancelAtPeriodEnd,
  NoActiveSubscriptionError,
} from "@/lib/stripe/subscription";

export async function POST(request: NextRequest) {
  try {
    const user = await requireBearerUser(request);
    await setSubscriptionCancelAtPeriodEnd(user.id, true);
    const detail = await getSubscriptionDetailForUser(user.id);
    return NextResponse.json(detail);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof NoActiveSubscriptionError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    await captureException(err, { route: "desktop/subscription/cancel" });
    return NextResponse.json({ error: "Could not cancel the subscription" }, { status: 500 });
  }
}
