import "server-only";
import type Stripe from "stripe";
import { createStripeClient } from "@focuslock/billing-server";
import { config } from "@/lib/config";

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (stripe) return stripe;
  stripe = createStripeClient({
    secretKey: config.stripe.secretKey,
    appName: config.app.name,
    appUrl: config.app.url,
  });
  return stripe;
}
