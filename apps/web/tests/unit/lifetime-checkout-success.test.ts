// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  retrieveSession: vi.fn(),
  fulfillLifetimeCheckoutSession: vi.fn(),
  syncSubscription: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/config", () => ({ config: { app: { url: "http://localhost:3000" } } }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({ checkout: { sessions: { retrieve: mocks.retrieveSession } } }),
}));
vi.mock("@/lib/stripe/lifetime", () => ({
  fulfillLifetimeCheckoutSession: mocks.fulfillLifetimeCheckoutSession,
}));
vi.mock("@/lib/stripe/sync-subscription", () => ({ syncSubscription: mocks.syncSubscription }));
vi.mock("@/lib/sentry", () => ({ captureException: vi.fn() }));

import { GET as webSuccess } from "@/app/api/stripe/checkout/success/route";
import { GET as desktopSuccess } from "@/app/api/desktop/checkout/success/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "user-1" });
  mocks.retrieveSession.mockResolvedValue({
    id: "cs_lifetime", client_reference_id: "user-1", mode: "payment", subscription: null,
  });
  mocks.fulfillLifetimeCheckoutSession.mockResolvedValue(true);
});

describe("lifetime Checkout return routes", () => {
  it("grants an authenticated web buyer before redirecting to the app", async () => {
    const response = await webSuccess(new NextRequest(
      "http://localhost:3000/api/stripe/checkout/success?session_id=cs_lifetime",
    ));
    expect(response.status).toBe(307);
    expect(mocks.fulfillLifetimeCheckoutSession).toHaveBeenCalledWith("cs_lifetime", "user-1");
  });

  it("does not use another user's Checkout Session on the web return", async () => {
    mocks.retrieveSession.mockResolvedValueOnce({
      id: "cs_other", client_reference_id: "user-2", mode: "payment", subscription: null,
    });
    await webSuccess(new NextRequest(
      "http://localhost:3000/api/stripe/checkout/success?session_id=cs_other",
    ));
    expect(mocks.fulfillLifetimeCheckoutSession).not.toHaveBeenCalled();
  });

  it("grants a desktop buyer before issuing the deep link", async () => {
    const response = await desktopSuccess(new NextRequest(
      "http://localhost:3000/api/desktop/checkout/success?session_id=cs_lifetime",
    ));
    expect(response.status).toBe(307);
    expect(mocks.fulfillLifetimeCheckoutSession).toHaveBeenCalledWith("cs_lifetime");
  });
});
