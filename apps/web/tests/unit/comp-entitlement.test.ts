import { describe, it, expect, vi } from "vitest";
import { getSubscriptionDetail, getUserEntitlement } from "@talysman/billing-server";
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
        in: vi.fn(() => builder),
        order: vi.fn(() => builder),
        limit: vi.fn(async () => ({ data: rows, error: null })),
      };
      return builder;
    }),
  };
}

const grantRow = { user_id: "u1", source: "grant", status: "comped", current_period_end: null };
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
