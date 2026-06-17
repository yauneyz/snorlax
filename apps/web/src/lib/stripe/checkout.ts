import "server-only";
import { createCheckoutSession as createBillingCheckoutSession } from "@focuslock/billing-server";
import type { CheckoutPrice } from "@focuslock/product";
import { getStripe } from "@/lib/stripe/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { config } from "@/lib/config";

type Args = {
  userId: string;
  userEmail: string;
  price: CheckoutPrice;
};

export async function createCheckoutSession({ userId, userEmail, price }: Args) {
  return createBillingCheckoutSession({
    stripe: getStripe(),
    db: supabaseAdmin(),
    config: {
      appUrl: config.app.url,
      priceMonthly: config.stripe.priceMonthly,
      priceYearly: config.stripe.priceYearly,
    },
    userId,
    userEmail,
    price,
  });
}
