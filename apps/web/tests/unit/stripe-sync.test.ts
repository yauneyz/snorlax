import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the admin client. All calls return canned shapes mirroring supabase-js.
const upsertMock = vi.fn(async (_row: Record<string, unknown>) => ({ error: null }));
const selectEqMaybeSingleMock = vi.fn(async () => ({ data: { id: "user-123" }, error: null }));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: vi.fn(() => ({
      upsert: upsertMock,
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: selectEqMaybeSingleMock })),
      })),
    })),
  }),
}));

import { syncSubscription } from "@/lib/stripe/sync-subscription";

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_123",
    status: "active",
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    trial_start: null,
    trial_end: null,
    // current_period_* live on the item since API version 2025-03-31.basil.
    items: {
      data: [
        {
          price: { id: "price_m" },
          quantity: 1,
          current_period_start: 1_700_000_000,
          current_period_end: 1_702_592_000,
        },
      ],
    },
    customer: "cus_123",
    metadata: { user_id: "user-123" },
    ...overrides,
  } as unknown as Parameters<typeof syncSubscription>[0];
}

beforeEach(() => {
  upsertMock.mockClear();
  selectEqMaybeSingleMock.mockClear();
});

describe("syncSubscription", () => {
  it("upserts the expected row shape", async () => {
    await syncSubscription(fixture());
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const row = upsertMock.mock.calls[0][0];
    expect(row).toMatchObject({
      id: "sub_123",
      user_id: "user-123",
      status: "active",
      price_id: "price_m",
      quantity: 1,
      cancel_at_period_end: false,
    });
    // Timestamps should be ISO strings, not unix epochs.
    expect(typeof row.current_period_start).toBe("string");
  });

  it("is idempotent — second call is still an upsert, not a duplicate insert", async () => {
    await syncSubscription(fixture());
    await syncSubscription(fixture());
    expect(upsertMock).toHaveBeenCalledTimes(2);
  });

  it("clears cancel fields when the subscription is reactivated", async () => {
    await syncSubscription(fixture({ cancel_at: null, canceled_at: null }));
    const row = upsertMock.mock.calls[0][0];
    expect(row.cancel_at).toBeNull();
    expect(row.canceled_at).toBeNull();
  });
});
