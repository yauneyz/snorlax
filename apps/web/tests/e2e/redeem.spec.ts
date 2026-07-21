import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { generateCompCode, hashCompCode } from "../../src/lib/comp/code";

/**
 * The emailed complimentary-code link, end to end: a stranger with no account
 * clicks it and ends up on Pro. Needs a live Supabase (the local stack is fine)
 * because it mints a code and a throwaway user with the secret key.
 */
test.describe("complimentary code redemption", () => {
  test.skip(
    !process.env.SUPABASE_SECRET_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL,
    "Needs SUPABASE_SECRET_KEY + NEXT_PUBLIC_SUPABASE_URL (run `pnpm sync:env`)",
  );

  test("signed out → sign in → redeem → Pro", async ({ page }) => {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
      { auth: { persistSession: false } },
    );

    const code = generateCompCode();
    const { error: codeError } = await admin
      .from("comp_codes")
      .insert({ code_hash: hashCompCode(code), note: "e2e", max_redemptions: 1 });
    if (codeError) throw new Error(codeError.message);

    const email = `e2e-comp-${Date.now()}@example.com`;
    const password = "password123";
    const { data: created, error: userError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (userError) throw userError;

    try {
      // The link is unlisted, so an anonymous visitor is routed through login
      // and back to the code rather than losing it.
      await page.goto(`/redeem/${code}`);
      await expect(page).toHaveURL(/\/login\?next=.*redeem/);

      await page.getByLabel(/email/i).fill(email);
      await page.getByLabel(/password/i).fill(password);
      await page.getByRole("button", { name: /^log in$/i }).click();

      await page.waitForURL(new RegExp(`/redeem/${code}`));
      await expect(page.locator('input[type="text"]')).toHaveValue(code);

      // Redemption is an explicit click — loading the URL must never burn the code.
      await page.getByRole("button", { name: /^redeem$/i }).click();
      await expect(page.getByText(/you're on pro/i)).toBeVisible();

      // The grant is live: the gated app renders instead of bouncing to /pricing.
      await page.goto("/app");
      await expect(page).toHaveURL(/\/app/);

      // …and it presents as complimentary, with no billing portal to open.
      await page.goto("/account");
      await expect(page.getByText(/pro \(complimentary\)/i)).toBeVisible();
      await expect(page.getByRole("button", { name: /manage billing/i })).toHaveCount(0);

      // Re-redeeming reports the existing comp without consuming anything.
      await page.goto(`/redeem/${code}`);
      await page.getByRole("button", { name: /^redeem$/i }).click();
      await expect(page.getByText(/already has complimentary pro/i)).toBeVisible();
    } finally {
      await admin.auth.admin.deleteUser(created.user.id);
      await admin.from("comp_codes").delete().eq("code_hash", hashCompCode(code));
    }
  });
});
