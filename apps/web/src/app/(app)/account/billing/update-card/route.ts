import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { config } from "@/lib/config";
import { captureException } from "@/lib/sentry";
import { createPortalSession } from "@/lib/stripe/portal";

/**
 * The failed-payment email's "Update my card" link. Opening a portal session changes
 * nothing, so a GET is safe for link scanners. Signed-out visitors are sent through login
 * by the middleware and come back here.
 */
export async function GET() {
  const user = await requireUser();
  try {
    const { url } = await createPortalSession(user.id, "update_card");
    return NextResponse.redirect(url, 303);
  } catch (err) {
    await captureException(err, { userId: user.id, route: "account/billing/update-card" });
    return NextResponse.redirect(`${config.app.url}/account`, 303);
  }
}
