// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  DEVICE_HEADERS,
  DEVICE_LIMIT_STATUS,
  PRO_DEVICE_LIMIT,
  PRO_DEVICE_STALE_AFTER_DAYS,
  entitlementForPlan,
} from "@talysman/product";

const mocks = vi.hoisted(() => ({
  requireBearerUser: vi.fn(),
  getUserEntitlement: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/require-bearer-user", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireBearerUser: mocks.requireBearerUser,
}));

vi.mock("@talysman/billing-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@talysman/billing-server")>()),
  getUserEntitlement: mocks.getUserEntitlement,
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({ rpc: mocks.rpc }),
}));

vi.mock("@/lib/sentry", () => ({ captureException: vi.fn() }));

import { applyDeviceLimit } from "@talysman/billing-server";
import { GET } from "@/app/api/desktop/entitlement/route";

const timing = { fetchedAt: "2026-10-05T00:00:00.000Z", cacheUntil: "2026-10-05T00:05:00.000Z" };
const pro = entitlementForPlan("pro", "server", { status: "active", ...timing });
const free = entitlementForPlan("free", "server", timing);
const device = { deviceId: "device-1", name: "laptop", platform: "linux" };

function request(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/desktop/entitlement", {
    headers: { authorization: "Bearer test-token", ...headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireBearerUser.mockResolvedValue({ id: "u1" });
});

describe("applyDeviceLimit", () => {
  it("leaves Free alone and never records the device", async () => {
    const result = await applyDeviceLimit({ db: { rpc: mocks.rpc }, userId: "u1", entitlement: free, device });
    expect(result).toEqual(free);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps Pro when the device gets a slot, claiming with the product limits", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const result = await applyDeviceLimit({ db: { rpc: mocks.rpc }, userId: "u1", entitlement: pro, device });
    expect(result).toEqual(pro);
    expect(mocks.rpc).toHaveBeenCalledWith("claim_entitled_device", {
      p_user_id: "u1",
      p_device_id: "device-1",
      p_name: "laptop",
      p_platform: "linux",
      p_limit: PRO_DEVICE_LIMIT,
      p_stale_after: `${PRO_DEVICE_STALE_AFTER_DAYS} days`,
    });
  });

  it("answers Free with the device-limit status when every slot is taken", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const result = await applyDeviceLimit({ db: { rpc: mocks.rpc }, userId: "u1", entitlement: pro, device });
    expect(result).toEqual({ active: false, plan: "free", source: "server", status: DEVICE_LIMIT_STATUS, ...timing });
  });

  it("throws rather than guessing when the claim fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(
      applyDeviceLimit({ db: { rpc: mocks.rpc }, userId: "u1", entitlement: pro, device }),
    ).rejects.toThrow("boom");
  });
});

describe("GET /api/desktop/entitlement", () => {
  it("doesn't count clients that send no device id (builds from before the limit)", async () => {
    mocks.getUserEntitlement.mockResolvedValue(pro);
    const res = await GET(request());
    expect(await res.json()).toEqual(pro);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("claims a slot for the requesting device from its headers", async () => {
    mocks.getUserEntitlement.mockResolvedValue(pro);
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const res = await GET(
      request({
        [DEVICE_HEADERS.id]: "device-1",
        [DEVICE_HEADERS.name]: " laptop ",
        [DEVICE_HEADERS.platform]: "linux",
      }),
    );
    expect(await res.json()).toEqual(pro);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "claim_entitled_device",
      expect.objectContaining({ p_device_id: "device-1", p_name: "laptop", p_platform: "linux" }),
    );
  });

  it("returns the device-limit Free entitlement when the account is full", async () => {
    mocks.getUserEntitlement.mockResolvedValue(pro);
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const res = await GET(request({ [DEVICE_HEADERS.id]: "device-6" }));
    expect(await res.json()).toMatchObject({ active: false, plan: "free", status: DEVICE_LIMIT_STATUS });
  });

  it("is a 500, not Free, when the claim errors", async () => {
    mocks.getUserEntitlement.mockResolvedValue(pro);
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    const res = await GET(request({ [DEVICE_HEADERS.id]: "device-1" }));
    expect(res.status).toBe(500);
  });
});
