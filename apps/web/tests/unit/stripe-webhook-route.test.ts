// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  processed: new Map<string, string>(),
}));

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  retrieveSubscription: vi.fn(),
  syncSubscription: vi.fn(),
  sendEmail: vi.fn(),
  captureException: vi.fn(),
  track: vi.fn(),
  sendInsightsPush: vi.fn(),
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: mocks.constructEvent },
    subscriptions: { retrieve: mocks.retrieveSubscription },
  }),
}));

vi.mock("@/lib/stripe/sync-subscription", () => ({
  syncSubscription: mocks.syncSubscription,
}));

vi.mock("@/lib/resend/send", () => ({
  sendEmail: mocks.sendEmail,
}));

vi.mock("@/lib/sentry", () => ({
  captureException: mocks.captureException,
}));

// The analytics seam is stubbed so these tests stay about billing. `trackBillingEvent` is
// covered directly in tests/unit/analytics-billing.test.ts.
vi.mock("@/server/analytics/track", () => ({
  track: mocks.track,
  reportUsage: vi.fn(),
}));

vi.mock("@/server/insights/push", () => ({
  sendInsightsPush: mocks.sendInsightsPush,
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (_column: string, value: string) => ({
          maybeSingle: async () => {
            if (table === "stripe_events") {
              return {
                data: state.processed.has(value) ? { id: value } : null,
                error: null,
              };
            }
            if (table === "profiles") {
              return { data: { email: "billing@example.com" }, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
      upsert: async (row: { id: string; type: string }) => {
        if (table === "stripe_events") state.processed.set(row.id, row.type);
        return { error: null };
      },
    }),
  }),
}));

import { POST } from "@/app/api/stripe/webhook/route";

const subscription = {
  id: "sub_123",
  customer: "cus_123",
  items: { data: [{ current_period_end: 1_800_000_000 }] },
};

function event(type: string, id: string, object: Record<string, unknown>) {
  return { id, type, data: { object } };
}

function request(
  payload: ReturnType<typeof event>,
  signature: string | null = "valid-signature",
) {
  return new NextRequest("http://localhost:3000/api/stripe/webhook", {
    method: "POST",
    headers: signature ? { "stripe-signature": signature } : {},
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  state.processed.clear();
  vi.clearAllMocks();
  mocks.constructEvent.mockImplementation((raw: string, signature: string) => {
    if (signature !== "valid-signature") throw new Error("bad signature");
    return JSON.parse(raw);
  });
  mocks.retrieveSubscription.mockResolvedValue(subscription);
  mocks.syncSubscription.mockResolvedValue(undefined);
  mocks.sendEmail.mockResolvedValue({ id: "email_123" });
  mocks.captureException.mockResolvedValue(undefined);
  mocks.sendInsightsPush.mockResolvedValue(undefined);
});

describe("POST /api/stripe/webhook", () => {
  it("rejects missing and invalid signatures without side effects", async () => {
    const payload = event("invoice.payment_failed", "evt_unsigned", {});

    expect((await POST(request(payload, null))).status).toBe(400);
    expect((await POST(request(payload, "wrong"))).status).toBe(400);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(state.processed.size).toBe(0);
  });

  it("syncs every subscription lifecycle event from Stripe's current state", async () => {
    const types = [
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "customer.subscription.paused",
      "customer.subscription.resumed",
    ];

    for (const [index, type] of types.entries()) {
      const response = await POST(request(event(type, `evt_sub_${index}`, subscription)));
      expect(response.status).toBe(200);
    }

    expect(mocks.retrieveSubscription).toHaveBeenCalledTimes(types.length);
    expect(mocks.syncSubscription).toHaveBeenCalledTimes(types.length);
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "billing@example.com",
        template: "SubscriptionCancelled",
      }),
    );
  });

  it("uses checkout completion as a fast subscription sync path", async () => {
    const response = await POST(
      request(
        event("checkout.session.completed", "evt_checkout", {
          subscription: "sub_123",
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.retrieveSubscription).toHaveBeenCalledWith("sub_123", {
      expand: ["customer"],
    });
    expect(mocks.syncSubscription).toHaveBeenCalledWith(subscription);
  });

  it("sends a celebratory push only when a subscription becomes paid", async () => {
    const paid = {
      ...subscription,
      status: "active",
      trial_end: null,
      items: { data: [{ price: { id: "price_monthly" } }] },
    };
    const response = await POST(
      request(event("customer.subscription.created", "evt_paid", paid)),
    );

    expect(response.status).toBe(200);
    expect(mocks.sendInsightsPush).toHaveBeenCalledWith({ type: "paid_conversion" });

    mocks.sendInsightsPush.mockClear();
    await POST(
      request(
        event("customer.subscription.created", "evt_trial_no_push", {
          ...paid,
          status: "trialing",
          trial_end: 1_800_000_000,
        }),
      ),
    );
    expect(mocks.sendInsightsPush).not.toHaveBeenCalled();
  });

  it("sends payment-failure and refund emails with Stripe amounts", async () => {
    const failed = await POST(
      request(
        event("invoice.payment_failed", "evt_failed", {
          customer: "cus_123",
          hosted_invoice_url: "https://invoice.test/i_123",
          amount_due: 1000,
          currency: "usd",
        }),
      ),
    );
    const refunded = await POST(
      request(
        event("charge.refunded", "evt_refund", {
          customer: "cus_123",
          amount_refunded: 725,
          currency: "usd",
        }),
      ),
    );

    expect(failed.status).toBe(200);
    expect(refunded.status).toBe(200);
    expect(mocks.sendEmail).toHaveBeenCalledWith({
      to: "billing@example.com",
      template: "PaymentFailed",
      props: expect.objectContaining({
        invoiceUrl: "https://invoice.test/i_123",
        amount: 1000,
        currency: "usd",
      }),
    });
    expect(mocks.sendEmail).toHaveBeenCalledWith({
      to: "billing@example.com",
      template: "RefundIssued",
      props: expect.objectContaining({ amount: 725, currency: "usd" }),
    });
  });

  it("warns before the first charge when a trial is about to end", async () => {
    const response = await POST(
      request(
        event("customer.subscription.trial_will_end", "evt_trial", {
          customer: "cus_123",
          cancel_at_period_end: false,
          trial_end: 1_800_000_000,
        }),
      ),
    );

    expect(response.status).toBe(200);
    // Notification only — the row is already accurate, so nothing is re-synced.
    expect(mocks.syncSubscription).not.toHaveBeenCalled();
    expect(mocks.sendEmail).toHaveBeenCalledWith({
      to: "billing@example.com",
      template: "TrialEnding",
      props: expect.objectContaining({
        trialEnd: new Date(1_800_000_000 * 1000).toISOString(),
      }),
    });
  });

  it("stays quiet when the trial was already cancelled", async () => {
    // No charge is coming, so a "you're about to be billed" email would be a lie.
    const response = await POST(
      request(
        event("customer.subscription.trial_will_end", "evt_trial_cancelled", {
          customer: "cus_123",
          cancel_at_period_end: true,
          trial_end: 1_800_000_000,
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("deduplicates a redelivery without repeating email side effects", async () => {
    const payload = event("invoice.payment_failed", "evt_duplicate", {
      customer: "cus_123",
      amount_due: 1000,
      currency: "usd",
    });

    expect((await POST(request(payload))).status).toBe(200);
    const duplicate = await POST(request(payload));

    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ received: true, duplicate: true });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("reports a rejected email to Sentry but still settles the event", async () => {
    // A notification failure must not 500: Stripe would retry the whole event, and a
    // permanently undeliverable address could fail for days and get the endpoint disabled.
    mocks.sendEmail.mockRejectedValueOnce(new Error("Resend rejected the PaymentFailed email"));

    const response = await POST(
      request(
        event("invoice.payment_failed", "evt_email_failed", {
          customer: "cus_123",
          amount_due: 1000,
          currency: "usd",
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(state.processed.has("evt_email_failed")).toBe(true);
    expect(mocks.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Resend rejected the PaymentFailed email" }),
      expect.objectContaining({ eventId: "evt_email_failed", where: "notify" }),
    );
  });

  it("keeps syncing when only the notification fails", async () => {
    // The subscription row is authoritative; a failed cancellation email must not undo it.
    mocks.sendEmail.mockRejectedValueOnce(new Error("Resend unavailable"));

    const response = await POST(
      request(event("customer.subscription.deleted", "evt_cancel_email_failed", subscription)),
    );

    expect(response.status).toBe(200);
    expect(mocks.syncSubscription).toHaveBeenCalledTimes(1);
    expect(mocks.captureException).toHaveBeenCalledOnce();
  });

  it("emits subscription_renewed for a cycle invoice without emailing or syncing", async () => {
    // invoice.payment_succeeded is analytics-only. Renewals were previously invisible:
    // customer.subscription.updated fires on renewal but does not say a payment cleared.
    const response = await POST(
      request(
        event("invoice.payment_succeeded", "evt_renewal", {
          id: "in_cycle",
          billing_reason: "subscription_cycle",
          customer: "cus_123",
          amount_paid: 900,
          currency: "usd",
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.track).toHaveBeenCalledWith(
      expect.objectContaining({ event: "subscription_renewed", source: "server" }),
    );
    // The subscription row is already accurate, and a renewal is not something to email about.
    expect(mocks.syncSubscription).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("does not count the first invoice of a new subscription as a renewal", async () => {
    const response = await POST(
      request(
        event("invoice.payment_succeeded", "evt_first_invoice", {
          id: "in_create",
          billing_reason: "subscription_create",
          customer: "cus_123",
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("records the analytics event before the sync, so a 500 does not lose it", async () => {
    // Tracking is payload-derived and runs before any Stripe round trip. Stripe retries the
    // whole event, and the once-per-person idempotency keys make the replay a no-op.
    mocks.syncSubscription.mockRejectedValueOnce(new Error("Supabase unavailable"));

    const response = await POST(
      request(
        event("customer.subscription.created", "evt_track_before_sync", {
          ...subscription,
          status: "trialing",
          trial_end: 1_800_000_000,
          items: { data: [{ price: { id: "price_monthly" }, current_period_end: 1_800_000_000 }] },
        }),
      ),
    );

    expect(response.status).toBe(500);
    expect(mocks.track).toHaveBeenCalledWith(
      expect.objectContaining({ event: "trial_started", source: "server" }),
    );
  });

  it("returns 500 on a handler failure and succeeds on Stripe's retry", async () => {
    mocks.syncSubscription
      .mockRejectedValueOnce(new Error("Supabase unavailable"))
      .mockResolvedValueOnce(undefined);
    const payload = event("customer.subscription.updated", "evt_retry", subscription);

    expect((await POST(request(payload))).status).toBe(500);
    expect(state.processed.has("evt_retry")).toBe(false);
    expect((await POST(request(payload))).status).toBe(200);
    expect(state.processed.has("evt_retry")).toBe(true);
    expect(mocks.syncSubscription).toHaveBeenCalledTimes(2);
  });
});
