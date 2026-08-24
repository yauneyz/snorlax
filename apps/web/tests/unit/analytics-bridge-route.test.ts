// @vitest-environment node
import { describe, expect, it } from "vitest";

import { isAllowedDestination } from "@/app/api/desktop/bridge/route";

const APP = "https://www.talysman.app";
const SUPABASE = "https://abcdefgh.supabase.co";

describe("bridge destination allowlist", () => {
  it("accepts the Stripe hosts the desktop actually opens", () => {
    expect(isAllowedDestination("https://checkout.stripe.com/c/pay/cs_test_123", APP, SUPABASE)).toBe(true);
    expect(isAllowedDestination("https://billing.stripe.com/p/session/xyz", APP, SUPABASE)).toBe(true);
  });

  it("accepts our own Supabase project and app host", () => {
    expect(isAllowedDestination(`${SUPABASE}/auth/v1/authorize?provider=google`, APP, SUPABASE)).toBe(true);
    expect(isAllowedDestination(`${APP}/pricing`, APP, SUPABASE)).toBe(true);
  });

  it("rejects an unrelated host", () => {
    expect(isAllowedDestination("https://evil.example.com/phish", APP, SUPABASE)).toBe(false);
  });

  /**
   * The suffix check must be on a dot boundary. `stripe.com.evil.test` and `notstripe.com`
   * both contain the allowed host as a substring and are the shapes an open-redirect probe
   * actually takes.
   */
  it("rejects hosts that merely embed an allowed one", () => {
    expect(isAllowedDestination("https://stripe.com.evil.test/pay", APP, SUPABASE)).toBe(false);
    expect(isAllowedDestination("https://notstripe.com/pay", APP, SUPABASE)).toBe(false);
    expect(isAllowedDestination("https://abcdefgh.supabase.co.evil.test/", APP, SUPABASE)).toBe(false);
  });

  it("rejects a different Supabase project", () => {
    expect(isAllowedDestination("https://someoneelse.supabase.co/auth/v1/authorize", APP, SUPABASE)).toBe(false);
  });

  it("rejects non-https schemes", () => {
    expect(isAllowedDestination("http://checkout.stripe.com/c/pay", APP, SUPABASE)).toBe(false);
    expect(isAllowedDestination("javascript:alert(1)", APP, SUPABASE)).toBe(false);
    expect(isAllowedDestination("data:text/html,<script>alert(1)</script>", APP, SUPABASE)).toBe(false);
  });

  it("rejects anything that is not an absolute URL", () => {
    expect(isAllowedDestination("", APP, SUPABASE)).toBe(false);
    expect(isAllowedDestination("/app", APP, SUPABASE)).toBe(false);
    expect(isAllowedDestination("//checkout.stripe.com/c/pay", APP, SUPABASE)).toBe(false);
  });

  it("is case-insensitive about the host", () => {
    expect(isAllowedDestination("https://CHECKOUT.Stripe.COM/c/pay", APP, SUPABASE)).toBe(true);
  });
});
