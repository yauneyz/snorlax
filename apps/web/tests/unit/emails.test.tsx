import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { WelcomeEmail } from "../../emails/WelcomeEmail";
import { PaymentFailedEmail } from "../../emails/PaymentFailedEmail";
import { SubscriptionCancelledEmail } from "../../emails/SubscriptionCancelledEmail";
import { RefundIssuedEmail } from "../../emails/RefundIssuedEmail";

describe("email templates", () => {
  it("WelcomeEmail renders with the app name", async () => {
    const html = await render(<WelcomeEmail appName="Acme" userName="Alice" />);
    expect(html).toContain("Acme");
  });

  it("PaymentFailedEmail includes the formatted amount", async () => {
    const html = await render(
      <PaymentFailedEmail appName="Acme" invoiceUrl="https://example.com/i" amount={2000} currency="usd" />,
    );
    expect(html).toContain("$20");
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
});
