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
