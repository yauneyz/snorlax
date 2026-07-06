import { NextRequest, NextResponse } from "next/server";
import {
  DESKTOP_BILLING_SUCCESS_PATH,
  desktopDeepLinkUrl,
} from "@talysman/auth-contracts";
import { captureException } from "@/lib/sentry";
import { getStripe } from "@/lib/stripe/client";
import { syncSubscription } from "@/lib/stripe/sync-subscription";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("session_id");
  const destination = desktopDeepLinkUrl(DESKTOP_BILLING_SUCCESS_PATH, {
    checkout: sessionId ? "success" : undefined,
  });

  if (sessionId) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(sessionId, {
        expand: ["subscription.customer"],
      });
      if (session.subscription && typeof session.subscription !== "string") {
        await syncSubscription(session.subscription);
      }
    } catch (err) {
      await captureException(err, { sessionId, route: "desktop/checkout/success" });
    }
  }

  return NextResponse.redirect(destination);
}
