import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  cancelCurrentSubscription,
  getSubscriptionDetail,
  setCancelAtPeriodEnd,
  NoActiveSubscriptionError,
} from "@talysman/billing-server";
import type Stripe from "stripe";

const config = { priceMonthly: "price_m", priceYearly: "price_y" };

const subRow = {
  id: "sub_123",
  status: "active",
  price_id: "price_m",
  cancel_at_period_end: false,
  current_period_end: "2026-08-01T00:00:00.000Z",
  canceled_at: null,
  updated_at: "2026-07-01T00:00:00.000Z",
};

// Chainable fake of the supabase query builder: every filter returns the builder,
// and the terminal `limit` resolves with the canned rows. `upsert` records writes.
const upsertMock = vi.fn(async () => ({ error: null }));
let rows: Array<Record<string, unknown>> = [];

function fakeDb() {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(async () => ({ data: rows, error: null })),
  };
  return {
    from: vi.fn(() => ({ ...builder, upsert: upsertMock })),
  };
}

function fakeStripeSub(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_123",
    status: "active",
    cancel_at_period_end: true,
    cancel_at: 1_754_006_400,
    canceled_at: null,
    trial_start: null,
    trial_end: null,
    metadata: { user_id: "user-123" },
    customer: "cus_123",
    items: {
      data: [
        {
          price: { id: "price_m" },
          quantity: 1,
          current_period_start: 1_751_328_000,
          current_period_end: 1_754_006_400,
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

beforeEach(() => {
  rows = [];
  upsertMock.mockClear();
});

describe("getSubscriptionDetail", () => {
  it("returns a free plan with no subscription row", async () => {
    const detail = await getSubscriptionDetail({
      db: fakeDb(),
      config,
      userId: "user-123",
      now: new Date("2026-07-15T00:00:00.000Z"),
    });
    expect(detail).toEqual({ hasSubscription: false, plan: "free" });
  });

  it("maps a monthly subscription row", async () => {
    rows = [subRow];
    const detail = await getSubscriptionDetail({
      db: fakeDb(),
      config,
      userId: "user-123",
      now: new Date("2026-07-15T00:00:00.000Z"),
    });
    expect(detail).toEqual({
      hasSubscription: true,
      plan: "pro",
      status: "active",
      price: "monthly",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      canceledAt: null,
    });
  });

  it("maps the yearly price id to the yearly price", async () => {
    rows = [{ ...subRow, price_id: "price_y" }];
    const detail = await getSubscriptionDetail({
      db: fakeDb(),
      config,
      userId: "user-123",
      now: new Date("2026-07-15T00:00:00.000Z"),
    });
    expect(detail.price).toBe("yearly");
  });

  it("does not silently call an unknown Stripe price monthly", async () => {
    rows = [{ ...subRow, price_id: "price_retired" }];
    const detail = await getSubscriptionDetail({
      db: fakeDb(),
      config,
      userId: "user-123",
      now: new Date("2026-07-15T00:00:00.000Z"),
    });
    expect(detail.price).toBeUndefined();
  });

  it("surfaces cancel-at-period-end and past_due status", async () => {
    rows = [{ ...subRow, status: "past_due", cancel_at_period_end: true }];
    const detail = await getSubscriptionDetail({ db: fakeDb(), config, userId: "user-123" });
    expect(detail.status).toBe("past_due");
    expect(detail.cancelAtPeriodEnd).toBe(true);
  });

  it("shows that Pro access needs verification after payment grace expires", async () => {
    rows = [{ ...subRow, status: "unpaid", updated_at: "2026-06-01T00:00:00.000Z" }];
    const detail = await getSubscriptionDetail({
      db: fakeDb(),
      config,
      userId: "user-123",
      now: new Date("2026-07-02T00:00:00.000Z"),
    });
    expect(detail).toMatchObject({ hasSubscription: true, plan: "free", status: "unpaid" });
  });
});

describe("setCancelAtPeriodEnd", () => {
  it("throws NoActiveSubscriptionError when the user has no current subscription", async () => {
    const stripe = { subscriptions: { update: vi.fn() } } as unknown as Stripe;
    await expect(
      setCancelAtPeriodEnd({ db: fakeDb(), stripe, userId: "user-123", cancel: true }),
    ).rejects.toBeInstanceOf(NoActiveSubscriptionError);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("updates Stripe and syncs the fresh subscription into the DB", async () => {
    rows = [subRow];
    const update = vi.fn(async () => fakeStripeSub());
    const stripe = { subscriptions: { update } } as unknown as Stripe;

    await setCancelAtPeriodEnd({ db: fakeDb(), stripe, userId: "user-123", cancel: true });

    expect(update).toHaveBeenCalledWith("sub_123", { cancel_at_period_end: true });
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [row] = upsertMock.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(row.id).toBe("sub_123");
    expect(row.cancel_at_period_end).toBe(true);
  });

  it("clears the flag on resume", async () => {
    rows = [{ ...subRow, cancel_at_period_end: true }];
    const update = vi.fn(async () => fakeStripeSub({ cancel_at_period_end: false, cancel_at: null }));
    const stripe = { subscriptions: { update } } as unknown as Stripe;

    await setCancelAtPeriodEnd({ db: fakeDb(), stripe, userId: "user-123", cancel: false });

    expect(update).toHaveBeenCalledWith("sub_123", { cancel_at_period_end: false });
    const [row] = upsertMock.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(row.cancel_at_period_end).toBe(false);
  });
});

describe("cancelCurrentSubscription", () => {
  it("immediately cancels and syncs a paid subscription", async () => {
    rows = [subRow];
    const cancel = vi.fn(async () =>
      fakeStripeSub({ status: "canceled", cancel_at_period_end: false }),
    );
    const stripe = { subscriptions: { cancel } } as unknown as Stripe;

    await expect(
      cancelCurrentSubscription({ db: fakeDb(), stripe, userId: "user-123" }),
    ).resolves.toBe(true);

    expect(cancel).toHaveBeenCalledWith("sub_123");
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [row] = upsertMock.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(row.status).toBe("canceled");
  });

  it("is a no-op when there is no paid subscription", async () => {
    const cancel = vi.fn();
    const stripe = { subscriptions: { cancel } } as unknown as Stripe;

    await expect(
      cancelCurrentSubscription({ db: fakeDb(), stripe, userId: "user-123" }),
    ).resolves.toBe(false);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("recovers when Stripe was already canceled before the local sync", async () => {
    rows = [subRow];
    const canceled = fakeStripeSub({ status: "canceled", cancel_at_period_end: false });
    const stripe = {
      subscriptions: {
        cancel: vi.fn(async () => {
          throw new Error("already canceled");
        }),
        retrieve: vi.fn(async () => canceled),
      },
    } as unknown as Stripe;

    await expect(
      cancelCurrentSubscription({ db: fakeDb(), stripe, userId: "user-123" }),
    ).resolves.toBe(true);
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_123");
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });
});
