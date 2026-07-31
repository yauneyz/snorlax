import "server-only";
import {
  cancelCurrentSubscription,
  getSubscriptionDetail,
  setCancelAtPeriodEnd,
  NoActiveSubscriptionError,
} from "@talysman/billing-server";
import { getStripe } from "@/lib/stripe/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { config } from "@/lib/config";

export { NoActiveSubscriptionError };

export async function getSubscriptionDetailForUser(userId: string) {
  return getSubscriptionDetail({
    db: supabaseAdmin(),
    config: {
      priceMonthly: config.stripe.priceMonthly,
      priceYearly: config.stripe.priceYearly,
    },
    userId,
  });
}

export async function setSubscriptionCancelAtPeriodEnd(userId: string, cancel: boolean) {
  await setCancelAtPeriodEnd({
    db: supabaseAdmin(),
    stripe: getStripe(),
    userId,
    cancel,
  });
}

/**
 * Stop future paid renewals after complimentary access is granted. Returning false is
 * the normal no-paid-subscription case; every other failure is surfaced so redemption
 * can be retried until Stripe and the local projection agree.
 */
export async function cancelPaidSubscriptionForComp(userId: string): Promise<boolean> {
  return cancelCurrentSubscription({
    db: supabaseAdmin(),
    stripe: getStripe(),
    userId,
  });
}
