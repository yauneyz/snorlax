import "server-only";
import type Stripe from "stripe";
import { recordLifetimePurchase, recordLifetimeRefund } from "@talysman/billing-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { syncSubscription } from "@/lib/stripe/sync-subscription";
import { config } from "@/lib/config";

type VerifiedSession = {
  userId: string;
  customerId: string;
  paymentIntentId: string | null;
};

/** Only our configured one-time price, on this user's Stripe customer, can grant access. */
async function verifyLifetimeSession(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  expectedUserId?: string,
): Promise<VerifiedSession | null> {
  const userId = session.client_reference_id;
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (session.mode !== "payment" || !userId || !customerId ||
      (expectedUserId && userId !== expectedUserId)) return null;

  const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 2 });
  if (items.has_more || items.data.length !== 1 ||
      items.data[0].price?.id !== config.stripe.priceLifetime ||
      items.data[0].quantity !== 1) return null;

  const { data: profile, error } = await supabaseAdmin().from("profiles")
    .select("stripe_customer_id").eq("id", userId).single();
  if (error) throw new Error(`Failed to verify lifetime customer ${userId}: ${error.message}`);
  if (profile?.stripe_customer_id !== customerId) return null;

  const paymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent : session.payment_intent?.id ?? null;
  return { userId, customerId, paymentIntentId };
}

/** Used by both Checkout return paths and both paid-session webhook events. */
export async function fulfillLifetimeCheckoutSession(
  sessionId: string,
  expectedUserId?: string,
): Promise<boolean> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== "paid") return false;
  const verified = await verifyLifetimeSession(stripe, session, expectedUserId);
  if (!verified) return false;

  if (verified.paymentIntentId) {
    const intent = await stripe.paymentIntents.retrieve(verified.paymentIntentId, {
      expand: ["latest_charge"],
    });
    if (intent.status !== "succeeded") return false;
    const charge = typeof intent.latest_charge === "string"
      ? await stripe.charges.retrieve(intent.latest_charge) : intent.latest_charge;
    if (charge && charge.amount_refunded >= charge.amount) {
      await recordLifetimeRefund({
        db: supabaseAdmin(), userId: verified.userId,
        checkoutSessionId: session.id, paymentIntentId: verified.paymentIntentId,
      });
      return false;
    }
  }

  const active = await recordLifetimePurchase({
    db: supabaseAdmin(), userId: verified.userId,
    checkoutSessionId: session.id, paymentIntentId: verified.paymentIntentId,
  });
  if (!active) return false;

  // A lifetime buyer must not continue paying a recurring subscription. The
  // purchase is recorded first, so a cancellation failure makes the webhook
  // retry without denying their newly purchased access.
  for await (const sub of stripe.subscriptions.list({
    customer: verified.customerId, status: "all", limit: 100,
  })) {
    if (sub.status === "canceled" || sub.status === "incomplete_expired") continue;
    const canceled = await stripe.subscriptions.cancel(sub.id);
    await syncSubscription(canceled);
  }
  return true;
}

/** A full refund removes only the purchase backed by this PaymentIntent. */
export async function refundLifetimePurchase(charge: Stripe.Charge): Promise<boolean> {
  if (charge.amount_refunded < charge.amount || !charge.payment_intent) return false;
  const paymentIntentId = typeof charge.payment_intent === "string"
    ? charge.payment_intent : charge.payment_intent.id;
  const stripe = getStripe();
  const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
  const session = sessions.data[0];
  if (!session) return false;
  const verified = await verifyLifetimeSession(stripe, session);
  if (!verified || verified.paymentIntentId !== paymentIntentId) return false;
  await recordLifetimeRefund({
    db: supabaseAdmin(), userId: verified.userId,
    checkoutSessionId: session.id, paymentIntentId,
  });
  return true;
}
