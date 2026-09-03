/**
 * Billing analytics, derived from Stripe webhook payloads (analytics-arch.md §9.5).
 *
 * All billing events come from the webhook, never the client: the client can lie, navigate
 * away, or double-fire, and the webhook is already idempotent via `stripe_events`.
 *
 * **Everything here is payload-derived.** `billingSignalsFor()` reads only
 * `event.data.object` and `event.data.previous_attributes`, and identity resolution prefers
 * the `metadata.user_id` that `@talysman/billing-server` stamps onto the subscription and
 * customer at checkout creation, falling back to one `profiles` lookup by
 * `stripe_customer_id`. There is no `stripe.subscriptions.retrieve()` call on this path.
 *
 * Two reasons that matters:
 *
 * 1. §9.1 promises analytics never breaks a user flow. Analytics that *depends* on an
 *    outbound Stripe call is analytics that fails whenever Stripe is slow, and it fails
 *    after the money has already moved.
 * 2. It makes the webhook drivable by signed fixture payloads. A fixture carrying a fake
 *    `sub_…` id would 404 on `retrieve`, so a retrieve-derived implementation cannot be
 *    tested without hitting the real Stripe API — which is what the bot E2E suite needs to
 *    avoid.
 */
import "server-only";
import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { captureException } from "@/lib/sentry";
import { track } from "./track";
import type { AnalyticsEventName } from "@/lib/analytics/events";

export type BillingSignal = {
  event: AnalyticsEventName;
  props: Record<string, unknown>;
};

function priceIdOf(sub: Stripe.Subscription): string | undefined {
  return sub.items?.data?.[0]?.price?.id;
}

function subscriptionProps(sub: Stripe.Subscription): Record<string, unknown> {
  return {
    subscription_id: sub.id,
    price_id: priceIdOf(sub),
    status: sub.status,
  };
}

/**
 * Maps one Stripe event to zero or more analytics signals. Pure — no I/O, no Stripe SDK
 * calls — so the mapping can be exhaustively unit-tested against fixture payloads.
 *
 * Returns an array because a single `customer.subscription.updated` can legitimately mean
 * two things at once (a trial converting *and* being set to cancel at period end).
 */
export function billingSignalsFor(event: Stripe.Event): BillingSignal[] {
  switch (event.type) {
    case "customer.subscription.created": {
      const sub = event.data.object as Stripe.Subscription;
      // A trial and a paid start are different funnel steps, and conflating them makes
      // trial-to-paid conversion uncomputable.
      const isTrial = sub.status === "trialing" || sub.trial_end != null;
      return [
        {
          event: isTrial ? "trial_started" : "subscription_started",
          props: {
            ...subscriptionProps(sub),
            ...(sub.trial_end ? { trial_end: new Date(sub.trial_end * 1000).toISOString() } : {}),
          },
        },
      ];
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const previous = (event.data.previous_attributes ?? {}) as Partial<Stripe.Subscription>;
      const signals: BillingSignal[] = [];

      // The trial converting to paid. `subscription_started` is once-per-person, so if the
      // subscription was created without a trial and this also fires, the idempotency key
      // makes the second one a no-op rather than a double count.
      if (previous.status === "trialing" && sub.status === "active") {
        signals.push({ event: "subscription_started", props: subscriptionProps(sub) });
      }

      // Cancellation INTENT, not access loss — the user keeps the product until the period
      // ends. §5.1 splits these deliberately; reporting them as one number conflates
      // "decided to leave" with "actually gone", which are weeks apart and mean different
      // things for a save attempt.
      if (sub.cancel_at_period_end === true && previous.cancel_at_period_end === false) {
        signals.push({
          event: "subscription_canceled",
          props: {
            ...subscriptionProps(sub),
            ...(sub.cancel_at ? { cancel_at: new Date(sub.cancel_at * 1000).toISOString() } : {}),
          },
        });
      }

      return signals;
    }

    // Access has actually lapsed.
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      return [{ event: "subscription_ended", props: subscriptionProps(sub) }];
    }

    // Stripe fires this three days before a trial ends — the same moment `notifyTrialEnding`
    // sends its email (webhook/route.ts). Tracking it lets trial-conversion analysis see who
    // got the warning before converting or lapsing, instead of only seeing the two endpoints.
    case "customer.subscription.trial_will_end": {
      const sub = event.data.object as Stripe.Subscription;
      return [
        {
          event: "trial_ending_soon",
          props: {
            ...subscriptionProps(sub),
            ...(sub.trial_end ? { trial_end: new Date(sub.trial_end * 1000).toISOString() } : {}),
          },
        },
      ];
    }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      // Only cycle invoices are renewals. `subscription_create` is the first invoice of a
      // brand-new subscription, and counting it here would double-count every signup as a
      // renewal on day one.
      if (invoice.billing_reason !== "subscription_cycle") return [];
      return [
        {
          event: "subscription_renewed",
          props: {
            invoice_id: invoice.id,
            amount_paid: invoice.amount_paid,
            currency: invoice.currency,
          },
        },
      ];
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      return [
        {
          event: "payment_failed",
          props: {
            invoice_id: invoice.id,
            // Involuntary churn is worth separating from intentional churn, and the attempt
            // count is what distinguishes a blip from a dead card.
            attempt: invoice.attempt_count ?? 0,
            amount_due: invoice.amount_due,
            currency: invoice.currency,
          },
        },
      ];
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      return [
        {
          event: "refund_issued",
          props: {
            charge_id: charge.id,
            amount_refunded: charge.amount_refunded,
            currency: charge.currency,
          },
        },
      ];
    }

    // checkout.session.completed is deliberately absent: `customer.subscription.created`
    // fires for the same conversion and carries better data, so emitting both would double
    // count. `checkout_started` comes from the checkout routes, not here.
    default:
      return [];
  }
}

/** The Stripe customer id, whichever payload shape this event carries. */
export function customerIdFor(event: Stripe.Event): string | null {
  const object = event.data.object as {
    customer?: string | { id: string } | null;
  };
  const customer = object.customer;
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

/**
 * `user_id` without a network call. `@talysman/billing-server` stamps
 * `metadata: { user_id }` onto both the subscription and the customer when it creates the
 * checkout session, so the payload usually already knows. The `profiles` lookup is the
 * fallback for subscriptions created outside that path (e.g. by hand in the dashboard).
 */
export async function resolveUserIdFor(event: Stripe.Event): Promise<string | null> {
  const object = event.data.object as {
    metadata?: Stripe.Metadata | null;
    customer?: string | { deleted?: boolean; metadata?: Stripe.Metadata | null } | null;
  };

  const fromObject = object.metadata?.user_id;
  if (fromObject) return fromObject;

  const customer = object.customer;
  if (customer && typeof customer !== "string" && !customer.deleted) {
    const fromCustomer = customer.metadata?.user_id;
    if (fromCustomer) return fromCustomer;
  }

  const customerId = customerIdFor(event);
  if (!customerId) return null;

  const { data, error } = await supabaseAdmin()
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle<{ id: string }>();
  if (error) {
    await captureException(error, { customerId, where: "analytics.resolveUserIdFor" });
    return null;
  }
  return data?.id ?? null;
}

/**
 * Emits every analytics signal for a webhook event.
 *
 * Call this BEFORE `syncSubscription` so the analytics row lands even if a later Stripe
 * round trip fails and the handler returns 500 for Stripe to retry. Retries are safe: the
 * once-per-person events carry derived idempotency keys, and `stripe_events` short-circuits
 * a fully-processed event before this runs at all.
 *
 * Never throws — the webhook's job is to settle the billing state, and analytics must not
 * be able to make it fail.
 */
export async function trackBillingEvent(event: Stripe.Event): Promise<void> {
  try {
    const signals = billingSignalsFor(event);
    if (signals.length === 0) return;

    const userId = await resolveUserIdFor(event);
    const customerId = customerIdFor(event);
    const occurredAt = new Date(event.created * 1000);

    for (const signal of signals) {
      await track({
        event: signal.event,
        source: "server",
        userId,
        occurredAt,
        props: { ...signal.props, stripe_customer_id: customerId },
      });
    }
  } catch (err) {
    await captureException(err, {
      where: "analytics.trackBillingEvent",
      eventId: event.id,
      eventType: event.type,
    });
  }
}
