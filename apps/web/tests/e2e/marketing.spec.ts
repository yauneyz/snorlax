import { test, expect } from "@playwright/test";

test.describe("marketing surface", () => {
  test("/ renders landing and is indexable", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/./);
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
  });

  test("/pricing loads", async ({ page }) => {
    const r = await page.goto("/pricing");
    expect(r?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /pricing/i })).toBeVisible();
  });

  test("/blog index and slug render", async ({ page }) => {
    const r1 = await page.goto("/blog");
    expect(r1?.status()).toBe(200);
    const postHref = await page.locator('a[href^="/blog/"]').first().getAttribute("href");
    expect(postHref).toBeTruthy();
    const r2 = await page.goto(postHref!);
    expect(r2?.status()).toBe(200);
  });

  test("/privacy and /terms render", async ({ page }) => {
    expect((await page.goto("/privacy"))?.status()).toBe(200);
    expect((await page.goto("/terms"))?.status()).toBe(200);
  });

  test("/robots.txt disallows /app and /api", async ({ page }) => {
    const r = await page.goto("/robots.txt");
    const body = await r!.text();
    expect(body).toMatch(/Disallow:\s*\/app/);
    expect(body).toMatch(/Disallow:\s*\/api/);
  });

  test("/sitemap.xml lists at least the home URL", async ({ page }) => {
    const r = await page.goto("/sitemap.xml");
    const body = await r!.text();
    expect(body).toMatch(/<loc>.*\/<\/loc>/);
  });
});
