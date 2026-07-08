import { describe, expect, it } from "vitest";
import { serverSchema, publicSchema } from "@/lib/config";

const securityEnv = {
  TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  OAUTH_STATE_SECRET: "test-oauth-state-secret-at-least-32-chars",
};

const extensionHostingEnv = {
  EXTENSION_ARTIFACTS_BUCKET: "talysman-extension-artifacts-prod",
  EXTENSION_ARTIFACTS_REGION: "us-east-1",
  EXTENSION_PUBLIC_S3_BASE_URL:
    "https://talysman-extension-artifacts-prod.s3.us-east-1.amazonaws.com",
  EXTENSION_CHROME_STORE_URL: "https://chromewebstore.google.com/detail/talysman",
  EXTENSION_EDGE_STORE_URL: "https://microsoftedge.microsoft.com/addons/detail/talysman",
  EXTENSION_FIREFOX_STORE_URL: "https://addons.mozilla.org/firefox/addon/talysman/",
};

describe("config schemas", () => {
  it("publicSchema rejects missing NEXT_PUBLIC_APP_URL", () => {
    const r = publicSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("serverSchema rejects missing STRIPE_SECRET_KEY", () => {
    const r = serverSchema.safeParse({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_APP_NAME: "x",
      NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_xxx",
      SUPABASE_SECRET_KEY: "sb_secret_test",
      STRIPE_PRICE_MONTHLY: "price_m",
      STRIPE_PRICE_YEARLY: "price_y",
      STRIPE_WEBHOOK_SECRET: "whsec",
      RESEND_API_KEY: "re",
      RESEND_FROM: "a@b.com",
      ...extensionHostingEnv,
      ...securityEnv,
    });
    expect(r.success).toBe(false);
  });

  it("serverSchema accepts a complete config", () => {
    const r = serverSchema.safeParse({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_APP_NAME: "x",
      NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_xxx",
      SUPABASE_SECRET_KEY: "sb_secret_test",
      STRIPE_SECRET_KEY: "sk_test_xxx",
      STRIPE_WEBHOOK_SECRET: "whsec",
      STRIPE_PRICE_MONTHLY: "price_m",
      STRIPE_PRICE_YEARLY: "price_y",
      RESEND_API_KEY: "re",
      RESEND_FROM: "a@b.com",
      OPENAI_API_KEY: "sk_test_xxx",
      ...extensionHostingEnv,
      ...securityEnv,
    });
    expect(r.success).toBe(true);
  });

  it("normalizes copied Supabase service URLs to the project origin", () => {
    const r = publicSchema.safeParse({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_APP_NAME: "x",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co/rest/v1/",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_xxx",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.NEXT_PUBLIC_SUPABASE_URL).toBe("https://example.supabase.co");
    }
  });

  it("treats placeholder PostHog keys as disabled", () => {
    const r = publicSchema.safeParse({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_APP_NAME: "x",
      NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_xxx",
      NEXT_PUBLIC_POSTHOG_KEY: "phc_...",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.NEXT_PUBLIC_POSTHOG_KEY).toBe("");
    }
  });

  it("serverSchema allows local LLM provider without an OpenAI key", () => {
    const r = serverSchema.safeParse({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_APP_NAME: "x",
      NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_xxx",
      SUPABASE_SECRET_KEY: "sb_secret_test",
      STRIPE_SECRET_KEY: "sk_test_xxx",
      STRIPE_WEBHOOK_SECRET: "whsec",
      STRIPE_PRICE_MONTHLY: "price_m",
      STRIPE_PRICE_YEARLY: "price_y",
      RESEND_API_KEY: "re",
      RESEND_FROM: "a@b.com",
      LLM_PROVIDER: "local",
      ...extensionHostingEnv,
      ...securityEnv,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.LOCAL_LLM_ENDPOINT).toBe("http://127.0.0.1:11434/v1/chat/completions");
      expect(r.data.LOCAL_LLM_MODEL).toBe("qwen3-14b-awq");
    }
  });
});
