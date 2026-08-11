// @vitest-environment node
import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { billingSignalsFor, customerIdFor } from "@/server/analytics/billing";

/** Minimal Stripe.Event shaped enough for the pure mapping under test. */
function event<T>(
  type: string,
  object: T,
  previous_attributes?: Record<string, unknown>,
): Stripe.Event {
  return {
    id: "evt_test_1",
    type,
    created: 1_760_000_000,
    livemode: false,
    data: { object, ...(previous_attributes ? { previous_attributes } : {}) },
  } as unknown as Stripe.Event;
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_123",
    status: "active",
    customer: "cus_123",
    cancel_at_period_end: false,
    trial_end: null,
    items: { data: [{ price: { id: "price_monthly" } }] },
    ...overrides,
  };
}

describe("customer.subscription.created", () => {
  it("emits subscription_started for a paid start", () => {
    const signals = billingSignalsFor(event("customer.subscription.created", subscription()));
    expect(signals).toHaveLength(1);
    expect(signals[0].event).toBe("subscription_started");
    expect(signals[0].props).toMatchObject({ subscription_id: "sub_123", price_id: "price_monthly" });
  });

  it("emits trial_started, not subscription_started, when the subscription is trialing", () => {
    // Conflating these makes trial-to-paid conversion uncomputable.
    const signals = billingSignalsFor(
      event("customer.subscription.created", subscription({ status: "trialing", trial_end: 1_760_500_000 })),
    );
    expect(signals.map((s) => s.event)).toEqual(["trial_started"]);
    expect(signals[0].props.trial_end).toBe(new Date(1_760_500_000 * 1000).toISOString());
  });

  it("treats a trial_end with an active status as a trial too", () => {
    const signals = billingSignalsFor(
      event("customer.subscription.created", subscription({ trial_end: 1_760_500_000 })),
    );
    expect(signals.map((s) => s.event)).toEqual(["trial_started"]);
  });
});

describe("customer.subscription.updated", () => {
  it("emits nothing for an unremarkable update", () => {
    // The overwhelming majority of subscription.updated events are noise (renewal
    // bookkeeping, price sync). Emitting on all of them would drown the funnel.
    const signals = billingSignalsFor(
      event("customer.subscription.updated", subscription(), { status: "active" }),
    );
    expect(signals).toEqual([]);
  });

  it("emits subscription_started when a trial converts to paid", () => {
    const signals = billingSignalsFor(
      event("customer.subscription.updated", subscription({ status: "active" }), { status: "trialing" }),
    );
    expect(signals.map((s) => s.event)).toEqual(["subscription_started"]);
  });

  it("emits subscription_canceled for cancellation INTENT", () => {
    // Intent, not access loss: §5.1 splits these because they are weeks apart and mean
    // different things for a save attempt.
    const signals = billingSignalsFor(
      event(
        "customer.subscription.updated",
        subscription({ cancel_at_period_end: true, cancel_at: 1_761_000_000 }),
        { cancel_at_period_end: false },
      ),
    );
    expect(signals.map((s) => s.event)).toEqual(["subscription_canceled"]);
    expect(signals[0].props.cancel_at).toBe(new Date(1_761_000_000 * 1000).toISOString());
  });

  it("does not re-emit subscription_canceled when the flag was already set", () => {
    const signals = billingSignalsFor(
      event("customer.subscription.updated", subscription({ cancel_at_period_end: true }), {
        status: "active",
      }),
    );
    expect(signals).toEqual([]);
  });

  it("can emit two signals from one event", () => {
    // A trial converting and being set to cancel in the same update is unusual but legal.
    const signals = billingSignalsFor(
      event(
        "customer.subscription.updated",
        subscription({ status: "active", cancel_at_period_end: true }),
        { status: "trialing", cancel_at_period_end: false },
      ),
    );
    expect(signals.map((s) => s.event)).toEqual(["subscription_started", "subscription_canceled"]);
  });
});

describe("customer.subscription.deleted", () => {
  it("emits subscription_ended, distinct from the earlier cancel intent", () => {
    const signals = billingSignalsFor(
      event("customer.subscription.deleted", subscription({ status: "canceled" })),
    );
    expect(signals.map((s) => s.event)).toEqual(["subscription_ended"]);
  });
});

describe("invoice.payment_succeeded", () => {
  it("emits subscription_renewed only for a cycle invoice", () => {
    const signals = billingSignalsFor(
      event("invoice.payment_succeeded", {
        id: "in_1",
        billing_reason: "subscription_cycle",
        amount_paid: 900,
        currency: "usd",
        customer: "cus_123",
      }),
    );
    expect(signals.map((s) => s.event)).toEqual(["subscription_renewed"]);
    expect(signals[0].props).toMatchObject({ amount_paid: 900, currency: "usd" });
  });

  it("ignores the first invoice of a new subscription", () => {
    // Counting subscription_create here would double-count every signup as a day-one renewal.
    const signals = billingSignalsFor(
      event("invoice.payment_succeeded", {
        id: "in_1",
        billing_reason: "subscription_create",
        customer: "cus_123",
      }),
    );
    expect(signals).toEqual([]);
  });

  it("ignores a manual or one-off invoice", () => {
    const signals = billingSignalsFor(
      event("invoice.payment_succeeded", { id: "in_1", billing_reason: "manual", customer: "cus_1" }),
    );
    expect(signals).toEqual([]);
  });
});

describe("invoice.payment_failed", () => {
  it("emits payment_failed with the attempt count", () => {
    const signals = billingSignalsFor(
      event("invoice.payment_failed", {
        id: "in_2",
        attempt_count: 3,
        amount_due: 900,
        currency: "usd",
        customer: "cus_123",
      }),
    );
    expect(signals.map((s) => s.event)).toEqual(["payment_failed"]);
    // The attempt count is what distinguishes a blip from a dead card.
    expect(signals[0].props.attempt).toBe(3);
  });

  it("defaults a missing attempt_count to 0 so the props schema still validates", () => {
    const signals = billingSignalsFor(
      event("invoice.payment_failed", { id: "in_2", customer: "cus_123" }),
    );
    expect(signals[0].props.attempt).toBe(0);
  });
});

describe("charge.refunded", () => {
  it("emits refund_issued with the refunded amount", () => {
    const signals = billingSignalsFor(
      event("charge.refunded", {
        id: "ch_1",
        amount_refunded: 900,
        currency: "usd",
        customer: "cus_123",
      }),
    );
    expect(signals.map((s) => s.event)).toEqual(["refund_issued"]);
    expect(signals[0].props.amount_refunded).toBe(900);
  });
});

describe("events that must emit nothing", () => {
  it.each([
    "checkout.session.completed",
    "customer.subscription.paused",
    "customer.subscription.resumed",
    "customer.subscription.trial_will_end",
  ])("%s", (type) => {
    // checkout.session.completed is excluded on purpose: customer.subscription.created fires
    // for the same conversion with better data, so emitting both would double count.
    expect(billingSignalsFor(event(type, subscription()))).toEqual([]);
  });
});

describe("customerIdFor", () => {
  it("reads a string customer", () => {
    expect(customerIdFor(event("charge.refunded", { customer: "cus_9" }))).toBe("cus_9");
  });

  it("reads an expanded customer object", () => {
    expect(customerIdFor(event("charge.refunded", { customer: { id: "cus_9" } }))).toBe("cus_9");
  });

  it("returns null when there is no customer", () => {
    expect(customerIdFor(event("charge.refunded", {}))).toBeNull();
    expect(customerIdFor(event("charge.refunded", { customer: null }))).toBeNull();
  });
});
