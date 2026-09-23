// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  purchases: new Map<string, Record<string, unknown>>(),
}));

const mocks = vi.hoisted(() => ({
  retrieveSession: vi.fn(),
  listLineItems: vi.fn(),
  listSessions: vi.fn(),
  retrieveIntent: vi.fn(),
  listSubscriptions: vi.fn(),
  cancelSubscription: vi.fn(),
  syncSubscription: vi.fn(),
}));

vi.mock("@/lib/config", () => ({ config: { stripe: { priceLifetime: "price_lifetime" } } }));
vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    checkout: { sessions: {
      retrieve: mocks.retrieveSession,
      listLineItems: mocks.listLineItems,
      list: mocks.listSessions,
    } },
    paymentIntents: { retrieve: mocks.retrieveIntent },
    subscriptions: { list: mocks.listSubscriptions, cancel: mocks.cancelSubscription },
  }),
}));
vi.mock("@/lib/stripe/sync-subscription", () => ({ syncSubscription: mocks.syncSubscription }));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({
          single: async () => ({ data: { stripe_customer_id: "cus_user" }, error: null }),
        }) }) };
      }
      if (table === "lifetime_purchases") {
        return {
          upsert: async (row: Record<string, unknown>, options: { ignoreDuplicates?: boolean }) => {
            const id = row.checkout_session_id as string;
            if (!options.ignoreDuplicates || !state.purchases.has(id)) {
              state.purchases.set(id, { ...state.purchases.get(id), refunded_at: null, ...row });
            }
            return { error: null };
          },
          select: () => ({ eq: (_column: string, id: string) => ({
            single: async () => ({ data: state.purchases.get(id), error: null }),
          }) }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

import { fulfillLifetimeCheckoutSession, refundLifetimePurchase } from "@/lib/stripe/lifetime";

const session = {
  id: "cs_lifetime",
  mode: "payment",
  payment_status: "paid",
  client_reference_id: "user-1",
  customer: "cus_user",
  payment_intent: "pi_lifetime",
};

beforeEach(() => {
  state.purchases.clear();
  vi.clearAllMocks();
  mocks.retrieveSession.mockResolvedValue(session);
  mocks.listLineItems.mockResolvedValue({
    data: [{ price: { id: "price_lifetime" }, quantity: 1 }], has_more: false,
  });
  mocks.listSessions.mockResolvedValue({ data: [session] });
  mocks.retrieveIntent.mockResolvedValue({
    status: "succeeded", latest_charge: { amount: 14900, amount_refunded: 0 },
  });
  mocks.listSubscriptions.mockReturnValue([]);
  mocks.cancelSubscription.mockResolvedValue({ id: "sub_old", status: "canceled" });
  mocks.syncSubscription.mockResolvedValue(undefined);
});

describe("lifetime purchase fulfillment", () => {
  it("records the verified price and cancels recurring billing", async () => {
    mocks.listSubscriptions.mockReturnValue([{ id: "sub_old", status: "active" }]);
    expect(await fulfillLifetimeCheckoutSession(session.id, "user-1")).toBe(true);
    expect(state.purchases.get(session.id)).toMatchObject({
      user_id: "user-1", payment_intent_id: "pi_lifetime", refunded_at: null,
    });
    expect(mocks.cancelSubscription).toHaveBeenCalledWith("sub_old");
    expect(mocks.syncSubscription).toHaveBeenCalledOnce();
  });

  it("rejects unpaid, wrong-price, wrong-customer and wrong-user sessions", async () => {
    mocks.retrieveSession.mockResolvedValueOnce({ ...session, payment_status: "unpaid" });
    expect(await fulfillLifetimeCheckoutSession(session.id)).toBe(false);
    mocks.listLineItems.mockResolvedValueOnce({
      data: [{ price: { id: "price_other" }, quantity: 1 }], has_more: false,
    });
    expect(await fulfillLifetimeCheckoutSession(session.id)).toBe(false);
    mocks.retrieveSession.mockResolvedValueOnce({ ...session, customer: "cus_other" });
    expect(await fulfillLifetimeCheckoutSession(session.id)).toBe(false);
    expect(await fulfillLifetimeCheckoutSession(session.id, "another-user")).toBe(false);
    expect(state.purchases.size).toBe(0);
  });

  it("revokes only a fully refunded purchase and never restores it on replay", async () => {
    expect(await fulfillLifetimeCheckoutSession(session.id)).toBe(true);
    expect(await refundLifetimePurchase({
      amount: 14900, amount_refunded: 5000, payment_intent: "pi_lifetime",
    } as never)).toBe(false);
    expect(state.purchases.get(session.id)?.refunded_at).toBeNull();
    expect(await refundLifetimePurchase({
      amount: 14900, amount_refunded: 14900, payment_intent: "pi_lifetime",
    } as never)).toBe(true);
    expect(state.purchases.get(session.id)?.refunded_at).toEqual(expect.any(String));
    expect(await fulfillLifetimeCheckoutSession(session.id)).toBe(false);
    expect(state.purchases.get(session.id)?.refunded_at).toEqual(expect.any(String));
  });

  it("records a refund that reaches the webhook before the purchase event", async () => {
    expect(await refundLifetimePurchase({
      amount: 14900, amount_refunded: 14900, payment_intent: "pi_lifetime",
    } as never)).toBe(true);
    expect(await fulfillLifetimeCheckoutSession(session.id)).toBe(false);
    expect(state.purchases.get(session.id)?.refunded_at).toEqual(expect.any(String));
  });

  it("keeps a separate later purchase active when the first one is refunded", async () => {
    expect(await fulfillLifetimeCheckoutSession(session.id)).toBe(true);
    const second = { ...session, id: "cs_again", payment_intent: "pi_again" };
    mocks.retrieveSession.mockResolvedValue(second);
    expect(await fulfillLifetimeCheckoutSession(second.id)).toBe(true);
    mocks.listSessions.mockResolvedValue({ data: [session] });
    expect(await refundLifetimePurchase({
      amount: 14900, amount_refunded: 14900, payment_intent: "pi_lifetime",
    } as never)).toBe(true);
    expect(state.purchases.get(session.id)?.refunded_at).toEqual(expect.any(String));
    expect(state.purchases.get(second.id)?.refunded_at).toBeNull();
  });

  it("keeps access recorded if subscription cancellation needs a webhook retry", async () => {
    mocks.listSubscriptions.mockReturnValue([{ id: "sub_old", status: "active" }]);
    mocks.cancelSubscription.mockRejectedValueOnce(new Error("Stripe unavailable"));
    await expect(fulfillLifetimeCheckoutSession(session.id)).rejects.toThrow("Stripe unavailable");
    expect(state.purchases.get(session.id)?.refunded_at).toBeNull();
    expect(await fulfillLifetimeCheckoutSession(session.id)).toBe(true);
    expect(mocks.cancelSubscription).toHaveBeenCalledTimes(2);
  });
});
