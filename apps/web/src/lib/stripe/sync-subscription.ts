import "server-only";
import type Stripe from "stripe";
import {
  hasActiveLifetimePurchase,
  syncSubscription as syncBillingSubscription,
} from "@talysman/billing-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";

export async function syncSubscription(subscription: Stripe.Subscription) {
  const db = supabaseAdmin();
  const row = await syncBillingSubscription({ db, subscription });
  if (row.status === "canceled" || row.status === "incomplete_expired" ||
      !(await hasActiveLifetimePurchase({ db, userId: row.user_id }))) return row;

  // A subscription Checkout opened before the lifetime payment can finish
  // afterward. End it here too, so no recurring charge survives that race.
  let canceled: Stripe.Subscription;
  try {
    canceled = await getStripe().subscriptions.cancel(subscription.id);
  } catch (cancelError) {
    const current = await getStripe().subscriptions.retrieve(subscription.id);
    if (current.status !== "canceled") throw cancelError;
    canceled = current;
  }
  return syncBillingSubscription({ db, subscription: canceled });
}
