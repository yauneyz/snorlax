import "server-only";
import {
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
