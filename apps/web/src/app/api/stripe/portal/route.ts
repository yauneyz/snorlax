import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireUser } from "@/lib/auth/require-user";
import { createPortalSession, NoStripeCustomerError } from "@/lib/stripe/portal";

export async function POST() {
  const user = await requireUser();
  try {
    const { url } = await createPortalSession(user.id);
    return NextResponse.json({ url });
  } catch (err) {
    if (err instanceof NoStripeCustomerError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    Sentry.captureException(err, { extra: { userId: user.id, route: "stripe/portal" } });
    return NextResponse.json({ error: "Could not open the billing portal" }, { status: 500 });
  }
}
