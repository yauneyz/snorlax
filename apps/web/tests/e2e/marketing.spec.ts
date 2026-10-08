import { test, expect } from "@playwright/test";
import { LEGACY_INTENT_REDIRECTS } from "../../src/lib/content/intent/legacy-redirects";

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

    // Annual leads, shown as the yearly price. No literal amount: it comes from PRO_PRICE_CENTS.
    const annual = page.getByRole("radio", { name: /annual/i });
    await expect(annual).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".plan--pro .plan__price")).toHaveText(/^\$\d+(\.\d{2})?\/year$/);
    await expect(page.getByText(/billed annually/i)).toBeVisible();

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

  // Every indexable URL in the sitemap: 200, self-canonical, indexable, one h1, a unique title,
  // and its main copy in the server-rendered HTML (fetched without running any JS).
  test("every sitemap URL is indexable and server-rendered", async ({ page, request }) => {
    const sitemap = await (await request.get("/sitemap.xml")).text();
    const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => new URL(m[1]!).pathname);
    expect(urls.length).toBeGreaterThan(20);

    const titles = new Set<string>();
    for (const path of urls) {
      const raw = await request.get(path, { maxRedirects: 0 });
      expect(raw.status(), path).toBe(200);
      const html = await raw.text();
      expect(html.match(/<h1[\s>]/g)?.length ?? 0, `${path} h1 count`).toBe(1);
      expect(html, path).not.toMatch(/<meta name="robots" content="[^"]*noindex/);

      await page.goto(path);
      const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
      expect(new URL(canonical!).pathname.replace(/\/$/, "") || "/", path).toBe(
        path.replace(/\/$/, "") || "/",
      );
      const title = await page.title();
      expect(titles.has(title), `duplicate title: ${title}`).toBe(false);
      titles.add(title);

      // Search pages lead with "The short answer"; it must be in the HTML, not added by JS.
      if (html.includes("intent__answer")) expect(html).toContain("The short answer");
    }
  });

  test("renamed search pages permanently redirect", async ({ request }) => {
    for (const [from, to] of Object.entries(LEGACY_INTENT_REDIRECTS)) {
      const r = await request.get(`/${from}`, { maxRedirects: 0 });
      expect(r.status(), from).toBe(308);
      expect(new URL(r.headers().location!, "http://x").pathname).toBe(`/${to}`);
    }
  });
});
