import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createCheckoutSession as createBillingCheckoutSession } from "@talysman/billing-server";
import { checkoutSchema } from "@/lib/zod/checkout";
import { requireBearerUser, UnauthorizedError } from "@/lib/auth/require-bearer-user";
import { getStripe } from "@/lib/stripe/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { config } from "@/lib/config";

export async function POST(request: NextRequest) {
  try {
    const user = await requireBearerUser(request);
    const body = await request.json().catch(() => null);
    const parsed = checkoutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const { url } = await createBillingCheckoutSession({
      stripe: getStripe(),
      db: supabaseAdmin(),
      config: {
        appUrl: config.app.url,
        priceMonthly: config.stripe.priceMonthly,
        priceYearly: config.stripe.priceYearly,
        successUrl: `${config.app.url}/api/desktop/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${config.app.url}/api/desktop/checkout/cancel`,
      },
      userId: user.id,
      userEmail: user.email ?? "",
      price: parsed.data.price,
    });
    return NextResponse.json({ url });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    Sentry.captureException(err, { extra: { route: "desktop/checkout" } });
    return NextResponse.json({ error: "Checkout failed - please try again" }, { status: 500 });
  }
}
