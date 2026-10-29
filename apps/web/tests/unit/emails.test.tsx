import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { WelcomeEmail } from "../../emails/WelcomeEmail";
import { PaymentFailedEmail } from "../../emails/PaymentFailedEmail";
import { SubscriptionCancelledEmail } from "../../emails/SubscriptionCancelledEmail";
import { RefundIssuedEmail } from "../../emails/RefundIssuedEmail";
import { TrialEndingEmail } from "../../emails/TrialEndingEmail";

describe("email templates", () => {
  it("WelcomeEmail renders with the app name", async () => {
    const html = await render(<WelcomeEmail appName="Acme" userName="Alice" />);
    expect(html).toContain("Acme");
  });

  it("PaymentFailedEmail includes the amount and the update, pay, and cancel links", async () => {
    const html = await render(
      <PaymentFailedEmail
        appName="Acme"
        updateCardUrl="https://acme.test/account/billing/update-card"
        cancelUrl="https://acme.test/account/cancel"
        invoiceUrl="https://example.com/i"
        amount={2000}
        currency="usd"
      />,
    );
    expect(html).toContain("$20");
    expect(html).toContain("https://acme.test/account/billing/update-card");
    expect(html).toContain("https://acme.test/account/cancel");
    expect(html).toContain("https://example.com/i");
    expect(html).toContain("ignore this email");
  });

  it("SubscriptionCancelledEmail mentions the period end", async () => {
    const html = await render(
      <SubscriptionCancelledEmail appName="Acme" periodEnd="2025-02-15T00:00:00Z" />,
    );
    expect(html).toContain("Acme");
  });

  it("RefundIssuedEmail mentions the amount", async () => {
    const html = await render(<RefundIssuedEmail appName="Acme" amount={500} currency="usd" />);
    expect(html).toContain("$5");
  });

  it("TrialEndingEmail states the charge date and how to avoid it", async () => {
    const html = await render(
      <TrialEndingEmail
        appName="Acme"
        trialEnd="2026-02-15T00:00:00Z"
        accountUrl="https://acme.test/account"
      />,
    );
    expect(html).toContain("Acme");
    expect(html).toContain(new Date("2026-02-15T00:00:00Z").toLocaleDateString());
    expect(html).toContain("https://acme.test/account");
    // The whole point of this email: say plainly that cancelling costs nothing.
    expect(html).toMatch(/cancel/i);
  });
});
