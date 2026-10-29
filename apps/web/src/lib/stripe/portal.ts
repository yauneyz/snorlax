import "server-only";
import {
  createPortalSession as createBillingPortalSession,
  NoStripeCustomerError,
  type PortalFlow,
} from "@talysman/billing-server";
import { getStripe } from "@/lib/stripe/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { config } from "@/lib/config";

export { NoStripeCustomerError };

export async function createPortalSession(userId: string, flow?: PortalFlow) {
  return createBillingPortalSession({
    stripe: getStripe(),
    db: supabaseAdmin(),
    config: {
      appUrl: config.app.url,
      portalConfigId: config.stripe.portalConfigId,
    },
    userId,
    flow,
  });
}
