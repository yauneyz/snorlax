import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { captureException } from "@/lib/sentry";
import { cancelSubscriptionForUser, NoActiveSubscriptionError } from "@/lib/stripe/subscription";

export async function POST() {
  const user = await requireUser();
  try {
    const when = await cancelSubscriptionForUser(user.id);
    return NextResponse.json({ when });
  } catch (err) {
    if (err instanceof NoActiveSubscriptionError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    await captureException(err, { userId: user.id, route: "stripe/subscription/cancel" });
    return NextResponse.json({ error: "Could not cancel the subscription" }, { status: 500 });
  }
}
