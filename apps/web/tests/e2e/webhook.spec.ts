import { test, expect, request as pwRequest } from "@playwright/test";

test.describe("stripe webhook", () => {
  test("rejects unsigned requests with 400", async ({ baseURL }) => {
    const api = await pwRequest.newContext({ baseURL });
    const res = await api.post("/api/stripe/webhook", {
      data: { type: "ping" },
    });
    expect(res.status()).toBe(400);
  });
});
