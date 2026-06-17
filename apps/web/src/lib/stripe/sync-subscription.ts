import "server-only";
import type Stripe from "stripe";
import { syncSubscription as syncBillingSubscription } from "@focuslock/billing-server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function syncSubscription(subscription: Stripe.Subscription) {
  return syncBillingSubscription({ db: supabaseAdmin(), subscription });
}
