import { test, expect } from "@playwright/test";

test.describe("marketing surface", () => {
  test("/ renders landing and is indexable", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/./);
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
  });

  test("/pricing shows both plans and the annual/monthly switch", async ({ page }) => {
    const r = await page.goto("/pricing");
    expect(r?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /talysman free/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /talysman pro/i })).toBeVisible();

    // Annual leads, and its price must be stated per-month so nobody has to divide by 12.
    const annual = page.getByRole("radio", { name: /annual/i });
    await expect(annual).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText(/\$49 billed annually/i)).toBeVisible();

    await page.getByRole("radio", { name: /monthly/i }).click();
    await expect(page.getByText(/billed monthly/i)).toBeVisible();
  });

  test("/pricing offers the trial to a signed-out visitor", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByRole("button", { name: /try pro free for 14 days/i })).toBeVisible();
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
