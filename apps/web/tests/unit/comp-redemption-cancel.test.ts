import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  cancelPaidSubscriptionForComp: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({ rpc: mocks.rpc }),
}));

vi.mock("@/lib/stripe/subscription", () => ({
  cancelPaidSubscriptionForComp: mocks.cancelPaidSubscriptionForComp,
}));

import { redeemCompCode } from "@/lib/comp/redeem";

describe("complimentary redemption billing transition", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.cancelPaidSubscriptionForComp.mockReset();
  });

  it("cancels future paid renewals after a successful redemption", async () => {
    mocks.rpc.mockResolvedValue({ data: "ok", error: null });
    mocks.cancelPaidSubscriptionForComp.mockResolvedValue(true);

    const result = await redeemCompCode({
      userId: "paid-user",
      code: "TLY-2345-6789",
    });

    expect(mocks.cancelPaidSubscriptionForComp).toHaveBeenCalledWith("paid-user");
    expect(result).toMatchObject({
      outcome: "ok",
      subscriptionCanceled: true,
      message: expect.stringMatching(/has been canceled/i),
    });
  });

  it("does not touch billing for an invalid code", async () => {
    mocks.rpc.mockResolvedValue({ data: "not_found", error: null });

    const result = await redeemCompCode({
      userId: "paid-user-invalid",
      code: "TLY-2345-6789",
    });

    expect(mocks.cancelPaidSubscriptionForComp).not.toHaveBeenCalled();
    expect(result.outcome).toBe("not_found");
  });

  it("retries cancellation when the code was consumed before Stripe recovered", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: "ok", error: null })
      .mockResolvedValueOnce({ data: "already_comped", error: null });
    mocks.cancelPaidSubscriptionForComp
      .mockRejectedValueOnce(new Error("Stripe unavailable"))
      .mockResolvedValueOnce(true);

    await expect(
      redeemCompCode({
        userId: "paid-user-retry",
        code: "TLY-3456-789A",
      }),
    ).rejects.toThrow("Stripe unavailable");

    await expect(
      redeemCompCode({
        userId: "paid-user-retry",
        code: "TLY-3456-789A",
      }),
    ).resolves.toMatchObject({
      outcome: "already_comped",
      subscriptionCanceled: true,
    });
    expect(mocks.cancelPaidSubscriptionForComp).toHaveBeenCalledTimes(2);
  });
});
