import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/client";
import { syncSubscription } from "@/lib/stripe/sync-subscription";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/resend/send";
import { config } from "@/lib/config";
import { captureException } from "@/lib/sentry";
import { billingSignalsFor, trackBillingEvent } from "@/server/analytics/billing";
import { sendInsightsPush } from "@/server/insights/push";

// Node runtime is required: we read the raw body (`text()`) for signature
// verification, and the Edge runtime does not expose what Stripe needs.
export const runtime = "nodejs";

const relevantEvents = new Set<Stripe.Event["type"]>([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.trial_will_end",
  // Renewals were previously invisible: `customer.subscription.updated` fires on renewal but
  // does not tell you a payment cleared. Analytics-only — there is deliberately no `case` for
  // it in the switch below, so it sends no email and syncs nothing. The subscription row is
  // already accurate; only `subscription_renewed` needed a source.
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "charge.refunded",
]);

export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const raw = await request.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, config.stripe.webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Signature verification failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!relevantEvents.has(event.type)) {
    return NextResponse.json({ received: true });
  }

  // Stripe retries the whole event on any non-2xx, which would re-send
  // notification emails. Skip events we've already fully processed.
  if (await alreadyProcessed(event.id)) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  // Before the switch, deliberately: this is payload-derived and makes no Stripe round trip,
  // so the analytics row lands even when a later `retrieve` fails and we return 500 for Stripe
  // to retry. It cannot throw, so it cannot cost us the sync below.
  await trackBillingEvent(event);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription) {
          const subId =
            typeof session.subscription === "string" ? session.subscription : session.subscription.id;
          const subscription = await stripe.subscriptions.retrieve(subId, { expand: ["customer"] });
          await syncSubscription(subscription);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed": {
        const subscription = event.data.object as Stripe.Subscription;
        const full = await stripe.subscriptions.retrieve(subscription.id, { expand: ["customer"] });
        await syncSubscription(full);

        if (event.type === "customer.subscription.deleted") {
          await notify(event, () => notifyCancellation(full));
        }
        break;
      }
      case "customer.subscription.trial_will_end": {
        // Stripe fires this three days out. It is a notification only — the row is
        // already accurate, so there is nothing to sync.
        await notify(event, () => notifyTrialEnding(event.data.object as Stripe.Subscription));
        break;
      }
      case "invoice.payment_failed": {
        await notify(event, () => notifyPaymentFailed(event.data.object as Stripe.Invoice));
        break;
      }
      case "charge.refunded": {
        await notify(event, () => notifyRefund(event.data.object as Stripe.Charge));
        break;
      }
    }
  } catch (err) {
    await captureException(err, { eventType: event.type, eventId: event.id });
    // Returning 500 tells Stripe to retry.
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  await markProcessed(event);
  if (billingSignalsFor(event).some((signal) => signal.event === "subscription_started")) {
    await sendInsightsPush({ type: "paid_conversion" });
  }
  return NextResponse.json({ received: true });
}

async function alreadyProcessed(eventId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("stripe_events")
    .select("id")
    .eq("id", eventId)
    .maybeSingle<{ id: string }>();
  // On a failed lookup, process the event: sync is idempotent and a missed
  // dedup only risks a duplicate email, whereas skipping could lose the event.
  if (error) {
    await captureException(error, { eventId, where: "alreadyProcessed" });
    return false;
  }
  return data !== null;
}

async function markProcessed(event: Stripe.Event) {
  const { error } = await supabaseAdmin()
    .from("stripe_events")
    .upsert({ id: event.id, type: event.type }, { onConflict: "id" });
  if (error) {
    await captureException(error, { eventId: event.id, where: "markProcessed" });
  }
}

/**
 * Notification sends are best-effort, and deliberately cannot fail the webhook.
 *
 * By the time these run the authoritative state — the subscription row — is already
 * written, so a non-2xx would buy nothing: Stripe would retry the whole event, re-running
 * the sync and re-sending any email that did go out. A permanently undeliverable address
 * is worse than useless here, because it would fail every retry for days and can get the
 * endpoint disabled altogether, breaking sync for every customer over one bad address.
 * So a failure is reported and the event still settles.
 */
async function notify(event: Stripe.Event, send: () => Promise<void>) {
  try {
    await send();
  } catch (err) {
    await captureException(err, {
      eventId: event.id,
      eventType: event.type,
      where: "notify",
    });
  }
}

async function lookupProfileEmail(customerId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("profiles")
    .select("email")
    .eq("stripe_customer_id", customerId)
    .maybeSingle<{ email: string }>();
  // A lookup failure and a customer with no profile are indistinguishable to the caller
  // (both skip the email), so the error has to be reported here or it is lost.
  if (error) {
    await captureException(error, { customerId, where: "lookupProfileEmail" });
  }
  return data?.email ?? null;
}

async function notifyPaymentFailed(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;
  const email = await lookupProfileEmail(customerId);
  if (!email) return;
  await sendEmail({
    to: email,
    template: "PaymentFailed",
    props: {
      appName: config.app.name,
      invoiceUrl: invoice.hosted_invoice_url ?? `${config.app.url}/account`,
      amount: invoice.amount_due,
      currency: invoice.currency,
    },
  });
}

async function notifyCancellation(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const email = await lookupProfileEmail(customerId);
  if (!email) return;
  // Periods live on the items since API version 2025-03-31.basil; fall back
  // to "now" — a deleted subscription's period has ended.
  const periodEnd = sub.items.data[0]?.current_period_end;
  await sendEmail({
    to: email,
    template: "SubscriptionCancelled",
    props: {
      appName: config.app.name,
      periodEnd: (periodEnd ? new Date(periodEnd * 1000) : new Date()).toISOString(),
    },
  });
}

/**
 * Warn before the first charge. A trial that bills silently is the thing people
 * actually fear about trials, and the pricing page promises this email.
 */
async function notifyTrialEnding(sub: Stripe.Subscription) {
  // A subscription that was already cancelled during the trial will never be charged.
  if (sub.cancel_at_period_end || !sub.trial_end) return;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const email = await lookupProfileEmail(customerId);
  if (!email) return;
  await sendEmail({
    to: email,
    template: "TrialEnding",
    props: {
      appName: config.app.name,
      trialEnd: new Date(sub.trial_end * 1000).toISOString(),
      accountUrl: `${config.app.url}/account`,
    },
  });
}

async function notifyRefund(charge: Stripe.Charge) {
  const customerId = typeof charge.customer === "string" ? charge.customer : charge.customer?.id;
  if (!customerId) return;
  const email = await lookupProfileEmail(customerId);
  if (!email) return;
  await sendEmail({
    to: email,
    template: "RefundIssued",
    props: {
      appName: config.app.name,
      amount: charge.amount_refunded,
      currency: charge.currency,
    },
  });
}
