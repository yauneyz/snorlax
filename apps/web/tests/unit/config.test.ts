import { describe, expect, it } from "vitest";
import { serverSchema, publicSchema } from "@/lib/config";

const securityEnv = {
  TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  OAUTH_STATE_SECRET: "test-oauth-state-secret-at-least-32-chars",
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
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_xxx",
      SUPABASE_SECRET_KEY: "sb_secret_test",
      STRIPE_PRICE_MONTHLY: "price_m",
      STRIPE_PRICE_YEARLY: "price_y",
      STRIPE_WEBHOOK_SECRET: "whsec",
      RESEND_API_KEY: "re",
      RESEND_FROM: "a@b.com",
      ...securityEnv,
    });
    expect(r.success).toBe(false);
  });

  it("serverSchema accepts a complete config", () => {
    const r = serverSchema.safeParse({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_APP_NAME: "x",
      NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_xxx",
      SUPABASE_SECRET_KEY: "sb_secret_test",
      STRIPE_SECRET_KEY: "sk_test_xxx",
      STRIPE_WEBHOOK_SECRET: "whsec",
      STRIPE_PRICE_MONTHLY: "price_m",
      STRIPE_PRICE_YEARLY: "price_y",
      RESEND_API_KEY: "re",
      RESEND_FROM: "a@b.com",
      OPENAI_API_KEY: "sk_test_xxx",
      ...securityEnv,
    });
    expect(r.success).toBe(true);
  });

  it("normalizes copied Supabase service URLs to the project origin", () => {
    const r = publicSchema.safeParse({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_APP_NAME: "x",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co/rest/v1/",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
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
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
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
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_xxx",
      SUPABASE_SECRET_KEY: "sb_secret_test",
      STRIPE_SECRET_KEY: "sk_test_xxx",
      STRIPE_WEBHOOK_SECRET: "whsec",
      STRIPE_PRICE_MONTHLY: "price_m",
      STRIPE_PRICE_YEARLY: "price_y",
      RESEND_API_KEY: "re",
      RESEND_FROM: "a@b.com",
      LLM_PROVIDER: "local",
      ...securityEnv,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.LOCAL_LLM_ENDPOINT).toBe("http://127.0.0.1:11434/v1/chat/completions");
      expect(r.data.LOCAL_LLM_MODEL).toBe("qwen3-14b-awq");
    }
  });
});
