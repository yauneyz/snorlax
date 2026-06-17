import { test, expect } from "@playwright/test";

test.describe("auth flow (surface only — DB writes require a live Supabase)", () => {
  test("/login renders form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /log in/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });

  test("/signup renders form + google button", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: /create account/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /continue with google/i })).toBeVisible();
  });

  test("/forgot-password and /reset-password render", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByRole("heading", { name: /reset password/i })).toBeVisible();
    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: /choose a new password/i })).toBeVisible();
  });
});
