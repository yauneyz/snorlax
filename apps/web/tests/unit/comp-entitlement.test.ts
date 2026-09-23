import { describe, it, expect, vi } from "vitest";
import {
  AlreadyLifetimePurchaseError,
  getSubscriptionDetail,
  getUserEntitlement,
  setCancelAtPeriodEnd,
} from "@talysman/billing-server";
import { hashCompCode, normalizeCompCode, generateCompCode } from "@/lib/comp/code";

/**
 * Complimentary grants reach the app through the `active_entitlements` view, so
 * these tests drive the view's rows straight into the billing-server readers.
 */

const config = { priceMonthly: "price_m", priceYearly: "price_y" };

/** Chainable supabase-query-builder fake; `rowsByTable` is keyed by table name. */
function fakeDb(rowsByTable: Record<string, Array<Record<string, unknown>>>) {
  return {
    from: vi.fn((table: string) => {
      const rows = rowsByTable[table] ?? [];
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        is: vi.fn(() => builder),
        in: vi.fn(() => builder),
        order: vi.fn(() => builder),
        limit: vi.fn(async () => ({ data: rows, error: null })),
      };
      return builder;
    }),
  };
}

const grantRow = { user_id: "u1", source: "grant", status: "comped", current_period_end: null };
const lifetimeRow = { user_id: "u1", source: "lifetime_purchase", status: "lifetime", current_period_end: null };
const subRow = {
  user_id: "u1",
  source: "subscription",
  status: "active",
  current_period_end: "2026-09-01T00:00:00.000Z",
};

describe("getUserEntitlement with complimentary grants", () => {
  it("returns free when the user has neither a subscription nor a grant", async () => {
    const entitlement = await getUserEntitlement({
      db: fakeDb({ active_entitlements: [] }),
      userId: "u1",
    });
    expect(entitlement).toMatchObject({ active: false, plan: "free", source: "server" });
  });

  it("returns pro/comped for a lifetime grant, with no period end", async () => {
    const entitlement = await getUserEntitlement({
      db: fakeDb({ active_entitlements: [grantRow] }),
      userId: "u1",
    });
    expect(entitlement).toMatchObject({ active: true, plan: "pro", status: "comped" });
    expect(entitlement.currentPeriodEnd).toBeUndefined();
  });

  it("carries the end date of a time-limited grant", async () => {
    const entitlement = await getUserEntitlement({
      db: fakeDb({
        active_entitlements: [{ ...grantRow, current_period_end: "2027-01-01T00:00:00.000Z" }],
      }),
      userId: "u1",
    });
    expect(entitlement.currentPeriodEnd).toBe("2027-01-01T00:00:00.000Z");
  });

  it("prefers the paid subscription when a user holds both", async () => {
    const entitlement = await getUserEntitlement({
      db: fakeDb({ active_entitlements: [grantRow, subRow] }),
      userId: "u1",
    });
    expect(entitlement).toMatchObject({
      active: true,
      plan: "pro",
      status: "active",
      currentPeriodEnd: subRow.current_period_end,
    });
  });

  it("prefers permanent access over a remaining subscription", async () => {
    const entitlement = await getUserEntitlement({
      db: fakeDb({ active_entitlements: [subRow, lifetimeRow] }),
      userId: "u1",
    });
    expect(entitlement).toMatchObject({ active: true, plan: "pro", status: "lifetime" });
    expect(entitlement.currentPeriodEnd).toBeUndefined();
  });

  it("keeps an uncertain payment status on Pro for one month from its billing update", async () => {
    const updatedAt = "2026-07-01T00:00:00.000Z";
    const entitlement = await getUserEntitlement({
      db: fakeDb({
        active_entitlements: [],
        subscriptions: [
          {
            status: "past_due",
            current_period_end: "2026-07-10T00:00:00.000Z",
            updated_at: updatedAt,
          },
        ],
      }),
      userId: "u1",
      now: new Date("2026-07-30T00:00:00.000Z"),
    });
    expect(entitlement).toMatchObject({
      active: true,
      plan: "pro",
      status: "past_due",
      fetchedAt: updatedAt,
    });
  });

  it("requires verification after an uncertain payment status exceeds one month", async () => {
    const entitlement = await getUserEntitlement({
      db: fakeDb({
        active_entitlements: [],
        subscriptions: [
          {
            status: "unpaid",
            current_period_end: "2026-06-10T00:00:00.000Z",
            updated_at: "2026-06-01T00:00:00.000Z",
          },
        ],
      }),
      userId: "u1",
      now: new Date("2026-07-02T00:00:00.000Z"),
    });
    expect(entitlement).toMatchObject({ active: false, plan: "free", source: "server" });
  });
});

describe("getSubscriptionDetail for comped accounts", () => {
  it("reports pro without a subscription so billing controls stay hidden", async () => {
    const detail = await getSubscriptionDetail({
      db: fakeDb({ subscriptions: [], active_entitlements: [grantRow] }),
      config,
      userId: "u1",
    });
    expect(detail).toEqual({ hasSubscription: false, plan: "pro", status: "comped" });
  });

  it("reports free when there is no grant either", async () => {
    const detail = await getSubscriptionDetail({
      db: fakeDb({ subscriptions: [], active_entitlements: [] }),
      config,
      userId: "u1",
    });
    expect(detail).toEqual({ hasSubscription: false, plan: "free" });
  });

  it("reports a paid lifetime purchase without a renewal", async () => {
    const detail = await getSubscriptionDetail({
      db: fakeDb({
        subscriptions: [],
        lifetime_purchases: [{ checkout_session_id: "cs_paid" }],
      }),
      config,
      userId: "u1",
    });
    expect(detail).toEqual({ hasSubscription: false, plan: "pro", status: "lifetime" });
  });

  it("keeps billing controls visible if a recurring subscription remains", async () => {
    const detail = await getSubscriptionDetail({
      db: fakeDb({
        subscriptions: [{
          id: "sub_pending", status: "active", cancel_at_period_end: true,
          current_period_end: "2026-10-01T00:00:00.000Z",
        }],
        lifetime_purchases: [{ checkout_session_id: "cs_paid" }],
      }),
      config,
      userId: "u1",
    });
    expect(detail).toMatchObject({
      hasSubscription: true, plan: "pro", status: "lifetime", cancelAtPeriodEnd: true,
    });
  });

  it("refuses to resume recurring billing after a lifetime purchase", async () => {
    await expect(setCancelAtPeriodEnd({
      db: fakeDb({ lifetime_purchases: [{ checkout_session_id: "cs_paid" }] }),
      stripe: {} as never,
      userId: "u1",
      cancel: false,
    })).rejects.toBeInstanceOf(AlreadyLifetimePurchaseError);
  });
});

describe("comp code normalization", () => {
  it("hashes the same regardless of case, dashes, or spacing", () => {
    expect(hashCompCode("tly-4k2p-9xqr")).toBe(hashCompCode(" TLY4K2P9XQR "));
  });

  it("folds the characters people mistype (including inside the prefix, harmlessly)", () => {
    expect(normalizeCompCode("TLY-O0IL")).toBe("T1Y0011");
    expect(hashCompCode("TLY-O0IL")).toBe(hashCompCode("T1Y-0011"));
  });

  it("mints codes in the documented shape", () => {
    expect(generateCompCode()).toMatch(/^TLY-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });
});
