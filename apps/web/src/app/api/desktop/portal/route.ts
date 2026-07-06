import { NextRequest, NextResponse } from "next/server";
import { NoStripeCustomerError } from "@talysman/billing-server";
import { requireBearerUser, UnauthorizedError } from "@/lib/auth/require-bearer-user";
import { captureException } from "@/lib/sentry";
import { createPortalSession } from "@/lib/stripe/portal";

export async function POST(request: NextRequest) {
  try {
    const user = await requireBearerUser(request);
    const { url } = await createPortalSession(user.id);
    return NextResponse.json({ url });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof NoStripeCustomerError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    await captureException(err, { route: "desktop/portal" });
    return NextResponse.json({ error: "Could not open the billing portal" }, { status: 500 });
  }
}
