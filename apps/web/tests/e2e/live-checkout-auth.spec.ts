import { expect, type Locator, type Page, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const shouldRun = process.env.RUN_LIVE_CHECKOUT_E2E === "1";

test.describe("live auth + checkout flow", () => {
  test.skip(
    !shouldRun,
    "Set RUN_LIVE_CHECKOUT_E2E=1 to run the live Supabase + Stripe checkout test.",
  );
  test.skip(
    process.env.STRIPE_MODE === "live",
    "This test must only run against Stripe test mode.",
  );

  test("logs in, completes Stripe Checkout, and unlocks the subscribed app", async ({ page }) => {
    const env = readLiveEnv();
    const supabase = createClient(env.supabaseUrl, env.supabaseSecretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const stripe = new Stripe(env.stripeSecretKey, { apiVersion: "2026-05-27.dahlia" });
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `e2e+${runId}@example.com`;
    const password = `E2e-${runId}-password`;

    let userId: string | null = null;
    let stripeCustomerId: string | null = null;

    try {
      userId = await createConfirmedUser(supabase, email, password);
      await expectProfile(supabase, userId);

      await page.goto("/login");
      await page.getByLabel(/email/i).fill(email);
      await page.getByLabel(/password/i).fill(password);
      await page.getByRole("button", { name: /^log in$/i }).click();
      await page.waitForURL(/\/pricing|\/app/, { timeout: 15_000 });

      await page.goto("/pricing");
      await page
        .getByRole("button", { name: /subscribe/i })
        .first()
        .click();
      await expect(page).toHaveURL(/checkout\.stripe\.com/, { timeout: 20_000 });

      await completeStripeCheckout(page, email);
      await page.waitForURL(/\/(?:app|pricing)(?:\?|$)/, { timeout: 60_000 });

      const profile = await expectProfile(supabase, userId);
      stripeCustomerId = profile.stripe_customer_id;
      expect(stripeCustomerId, "profile should be linked to a Stripe customer").toMatch(/^cus_/);

      const subscription = await expectActiveSubscription(supabase, userId, env.stripePriceMonthly);
      expect(subscription.id).toMatch(/^sub_/);

      await page.goto("/app");
      await expect(page.getByRole("heading", { name: /welcome to/i })).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      if (!stripeCustomerId && userId) {
        stripeCustomerId = await lookupStripeCustomerId(supabase, userId).catch(() => null);
      }
      if (stripeCustomerId) {
        await cancelCustomerSubscriptions(stripe, stripeCustomerId);
        await stripe.customers.del(stripeCustomerId).catch(() => undefined);
      }
      if (userId) {
        await supabase.auth.admin.deleteUser(userId).catch(() => undefined);
      }
    }
  });
});

function readLiveEnv() {
  const env = {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    stripePriceMonthly: process.env.STRIPE_PRICE_MONTHLY,
  };
  for (const [name, value] of Object.entries(env)) {
    if (!value) throw new Error(`Missing required live E2E env value: ${name}`);
  }
  if (!env.stripeSecretKey!.startsWith("sk_test_")) {
    throw new Error("Live checkout E2E requires a Stripe test-mode secret key.");
  }
  return env as Record<keyof typeof env, string>;
}

async function createConfirmedUser(
  supabase: SupabaseClient,
  email: string,
  password: string,
): Promise<string> {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "E2E Checkout User" },
  });
  if (error) throw new Error(`Failed to create Supabase test user: ${error.message}`);
  if (!data.user) throw new Error("Supabase did not return a created user.");
  return data.user.id;
}

async function expectProfile(supabase: SupabaseClient, userId: string) {
  return await poll(async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,stripe_customer_id")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(`Failed to query profile: ${error.message}`);
    return data;
  }, `profile for ${userId}`);
}

async function expectActiveSubscription(
  supabase: SupabaseClient,
  userId: string,
  expectedPriceId: string,
) {
  return await poll(async () => {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("id,user_id,status,price_id,current_period_end")
      .eq("user_id", userId)
      .in("status", ["trialing", "active"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Failed to query subscription: ${error.message}`);
    if (!data) return null;
    if (data.price_id !== expectedPriceId) {
      throw new Error(`Expected price ${expectedPriceId}, got ${data.price_id}`);
    }
    if (new Date(data.current_period_end).getTime() <= Date.now()) {
      throw new Error("Subscription current_period_end is not in the future.");
    }
    return data;
  }, `active subscription for ${userId}`);
}

async function lookupStripeCustomerId(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to query profile cleanup state: ${error.message}`);
  return data?.stripe_customer_id ?? null;
}

async function completeStripeCheckout(page: Page, email: string) {
  await fillIfVisible(page.getByLabel(/^email$/i), email);
  await page.getByPlaceholder("1234 1234 1234 1234").fill("4242 4242 4242 4242");
  await page.getByPlaceholder(/MM\s*\/\s*YY/i).fill("12 / 34");
  await page.getByPlaceholder(/CVC/i).fill("123");
  await fillIfVisible(
    page.getByLabel(/cardholder name|name on card|full name/i),
    "E2E Checkout User",
  );
  await fillIfVisible(page.getByLabel(/zip|postal/i), "94107");
  await page.getByRole("button", { name: /subscribe|pay|start|confirm/i }).click();
}

async function fillIfVisible(locator: Locator, value: string) {
  if ((await locator.count()) === 0) return;
  const first = locator.first();
  if (await first.isVisible().catch(() => false)) {
    await first.fill(value);
  }
}

async function poll<T>(fn: () => Promise<T | null>, label: string, timeoutMs = 60_000): Promise<T> {
  const started = Date.now();
  let lastError: unknown = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${label}.${suffix}`);
}

async function cancelCustomerSubscriptions(stripe: Stripe, customerId: string) {
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  });
  for (const subscription of subscriptions.data) {
    if (!["canceled", "incomplete_expired"].includes(subscription.status)) {
      await stripe.subscriptions.cancel(subscription.id).catch(() => undefined);
    }
  }
}
