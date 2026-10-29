import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { cancelSubscriptionAtCustomerRequest } from "@talysman/billing-server";

function stripeSubscription(status: string, cancelAtPeriodEnd = false) {
  return {
    id: "sub_1",
    status,
    customer: "cus_1",
    metadata: { user_id: "user-1" },
    cancel_at_period_end: cancelAtPeriodEnd,
    items: {
      data: [{ price: { id: "price_m" }, quantity: 1, current_period_start: 1, current_period_end: 2 }],
    },
  };
}

function fakes(status: string) {
  const upserts: Array<{ status: string; cancel_at_period_end: boolean }> = [];
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            order: () => ({
              limit: async () => ({ data: [{ id: "sub_1", status }], error: null }),
            }),
          }),
        }),
      }),
      upsert: async (row: { status: string; cancel_at_period_end: boolean }) => {
        upserts.push(row);
        return { error: null };
      },
    }),
  };
  const stripe = {
    subscriptions: {
      update: vi.fn(async () => stripeSubscription(status, true)),
      cancel: vi.fn(async () => stripeSubscription("canceled")),
      retrieve: vi.fn(),
    },
    invoices: {
      list: vi.fn(() => [{ id: "in_open" }]),
      voidInvoice: vi.fn(async () => ({})),
    },
  };
  return { db, stripe, upserts };
}

describe("cancelSubscriptionAtCustomerRequest", () => {
  it("keeps paid-for time on a subscription in good standing", async () => {
    const { db, stripe, upserts } = fakes("active");
    const when = await cancelSubscriptionAtCustomerRequest({
      db,
      stripe: stripe as unknown as Stripe,
      userId: "user-1",
    });
    expect(when).toBe("at_period_end");
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: true });
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(stripe.invoices.voidInvoice).not.toHaveBeenCalled();
    expect(upserts.at(-1)?.cancel_at_period_end).toBe(true);
  });

  it("ends a past-due subscription now and voids what it still owes", async () => {
    const { db, stripe, upserts } = fakes("past_due");
    const when = await cancelSubscriptionAtCustomerRequest({
      db,
      stripe: stripe as unknown as Stripe,
      userId: "user-1",
    });
    expect(when).toBe("immediately");
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_1");
    expect(stripe.invoices.list).toHaveBeenCalledWith({ subscription: "sub_1", status: "open" });
    expect(stripe.invoices.voidInvoice).toHaveBeenCalledWith("in_open");
    expect(upserts.at(-1)?.status).toBe("canceled");
  });
});
