import { test, expect } from "@playwright/test";

test.describe("checkout (requires live Supabase + Stripe test mode)", () => {
  test.skip(!process.env.E2E_USER_EMAIL, "Set E2E_USER_EMAIL/E2E_USER_PASSWORD to run this");

  test("logged-in unsubscribed user can reach Stripe Checkout", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.E2E_USER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.E2E_USER_PASSWORD!);
    await page.getByRole("button", { name: /^log in$/i }).click();

    await page.waitForURL(/\/pricing|\/app/);
    await page.goto("/pricing");
    await page.getByRole("button", { name: /subscribe/i }).first().click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 15_000 });
    expect(page.url()).toContain("checkout.stripe.com");
  });
});
