import { describe, it, expect, vi } from "vitest";
import {
  formatPriceUsd,
  PRO_ANNUAL_SAVINGS_CENTS,
  PRO_PRICE_CENTS,
  PRO_TRIAL_DAYS,
} from "@talysman/product";
import { createCheckoutSession, isEligibleForTrial } from "@talysman/billing-server";

/**
 * Minimal stand-in for the Supabase table client. `subscriptionRows` is what a
 * `subscriptions` lookup returns; everything else is the happy-path profile read
 * `createCheckoutSession` performs first.
 */
function db(opts: { subscriptionRows?: unknown[]; subscriptionError?: { message: string } } = {}) {
  return {
    from(table: string) {
      if (table === "subscriptions") {
        const result = {
          data: opts.subscriptionError ? null : (opts.subscriptionRows ?? []),
          error: opts.subscriptionError ?? null,
        };
        const chain = {
          select: () => chain,
          eq: () => chain,
          limit: async () => result,
        };
        return chain;
      }
      // profiles
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({
          data: {
            id: "user-1",
            email: "a@b.test",
            stripe_customer_id: "cus_existing",
            full_name: null,
          },
          error: null,
        }),
      };
      return chain;
    },
  };
}

const billingConfig = {
  appUrl: "https://example.test",
  priceMonthly: "price_m",
  priceYearly: "price_y",
};

/** The subset of the Checkout params these tests assert on. */
type CheckoutArgs = {
  line_items: { price: string }[];
  subscription_data: { trial_period_days?: number };
};

function stripeStub(create: (args: CheckoutArgs) => Promise<{ url: string }>) {
  return { checkout: { sessions: { create } } } as never;
}

describe("trial eligibility", () => {
  it("offers a trial to a user with no subscription history", async () => {
    await expect(isEligibleForTrial({ db: db(), userId: "user-1" })).resolves.toBe(true);
  });

  it("refuses a second trial once any subscription row exists", async () => {
    // Includes long-cancelled subscriptions on purpose: cancel-and-resubscribe must
    // not be a way to hold Pro for free indefinitely.
    await expect(
      isEligibleForTrial({ db: db({ subscriptionRows: [{ id: "sub_old" }] }), userId: "user-1" }),
    ).resolves.toBe(false);
  });

  it("fails closed when the lookup errors", async () => {
    await expect(
      isEligibleForTrial({
        db: db({ subscriptionError: { message: "boom" } }),
        userId: "user-1",
      }),
    ).resolves.toBe(false);
  });
});

describe("checkout session trial wiring", () => {
  it("asks Stripe for a trial on a first subscription", async () => {
    const create = vi.fn(async (_args: CheckoutArgs) => ({ url: "https://checkout.test/x" }));
    await createCheckoutSession({
      db: db(),
      stripe: stripeStub(create),
      config: billingConfig,
      userId: "user-1",
      userEmail: "a@b.test",
      price: "yearly",
    });

    const args = create.mock.calls[0]![0];
    expect(args.subscription_data.trial_period_days).toBe(PRO_TRIAL_DAYS);
    expect(args.line_items[0]!.price).toBe("price_y");
  });

  it("omits the trial entirely for a returning subscriber", async () => {
    const create = vi.fn(async (_args: CheckoutArgs) => ({ url: "https://checkout.test/x" }));
    await createCheckoutSession({
      db: db({ subscriptionRows: [{ id: "sub_old" }] }),
      stripe: stripeStub(create),
      config: billingConfig,
      userId: "user-1",
      userEmail: "a@b.test",
      price: "monthly",
    });

    const args = create.mock.calls[0]![0];
    // Absent, not zero — Stripe treats `trial_period_days: 0` as an error.
    expect(args.subscription_data).not.toHaveProperty("trial_period_days");
  });
});

describe("displayed pricing", () => {
  it("states the annual saving against twelve monthly charges", () => {
    expect(PRO_ANNUAL_SAVINGS_CENTS).toBe(PRO_PRICE_CENTS.monthly * 12 - PRO_PRICE_CENTS.yearly);
  });

  it("formats whole dollars without cents and part-dollars with two digits", () => {
    expect(formatPriceUsd(PRO_PRICE_CENTS.monthly)).toBe("$4.99");
    expect(formatPriceUsd(PRO_PRICE_CENTS.yearly)).toBe("$49.99");
  });
});
