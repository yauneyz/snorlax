import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { captureException } from "@/lib/sentry";
import { getStripe } from "@/lib/stripe/client";
import { syncSubscription } from "@/lib/stripe/sync-subscription";
import { config } from "@/lib/config";

/**
 * Checkout success landing. Syncs the new subscription into the database
 * before sending the user to /app, so the middleware's entitlement check
 * passes even when the webhook hasn't been delivered yet. The webhook
 * remains the source of truth for all later updates.
 */
export async function GET(request: NextRequest) {
  const user = await requireUser();
  const sessionId = request.nextUrl.searchParams.get("session_id");
  const destination = new URL("/app?checkout=success", config.app.url);

  if (sessionId) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(sessionId, {
        expand: ["subscription.customer"],
      });
      if (
        session.client_reference_id === user.id &&
        session.subscription &&
        typeof session.subscription !== "string"
      ) {
        await syncSubscription(session.subscription);
      }
    } catch (err) {
      // Non-fatal: the webhook will sync shortly; worst case the user is
      // bounced to /pricing until it does.
      await captureException(err, { sessionId });
    }
  }

  return NextResponse.redirect(destination);
}
