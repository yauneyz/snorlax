// @vitest-environment node
// Node, not jsdom: config only exposes the server-only Resend values on the server branch.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@/lib/resend/client", () => ({
  getResend: () => ({ emails: { send: mocks.send } }),
}));

import { sendEmail, EmailSendError } from "@/lib/resend/send";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendEmail", () => {
  it("sends rendered HTML with the configured sender and template subject", async () => {
    mocks.send.mockResolvedValue({ data: { id: "email_123" }, error: null });

    const result = await sendEmail({
      to: "user@example.com",
      template: "Welcome",
      props: { appName: "Acme" },
    });

    expect(result).toEqual({ id: "email_123" });
    const [payload] = mocks.send.mock.calls[0];
    expect(payload).toMatchObject({
      from: process.env.RESEND_FROM,
      to: "user@example.com",
      subject: "Welcome to Test App",
    });
    expect(payload.html).toContain("Acme");
  });

  it("throws with Resend's reason instead of reporting success", async () => {
    // The SDK resolves with an `error` field rather than rejecting; a caller that only
    // awaits the promise would otherwise treat a rejected message as delivered.
    mocks.send.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "The acme.test domain is not verified." },
    });

    const failure = sendEmail({
      to: "user@example.com",
      template: "PaymentFailed",
      props: {
        appName: "Acme",
        invoiceUrl: "https://acme.test/i",
        amount: 1000,
        currency: "usd",
      },
    });

    await expect(failure).rejects.toBeInstanceOf(EmailSendError);
    await expect(failure).rejects.toThrow(/PaymentFailed/);
    await expect(failure).rejects.toThrow(/domain is not verified/);
  });
});
