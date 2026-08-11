import "server-only";
import { render } from "@react-email/components";
import { getResend } from "@/lib/resend/client";
import { config } from "@/lib/config";
import { WelcomeEmail, type WelcomeEmailProps } from "../../../emails/WelcomeEmail";
import { PaymentFailedEmail, type PaymentFailedEmailProps } from "../../../emails/PaymentFailedEmail";
import {
  SubscriptionCancelledEmail,
  type SubscriptionCancelledEmailProps,
} from "../../../emails/SubscriptionCancelledEmail";
import { RefundIssuedEmail, type RefundIssuedEmailProps } from "../../../emails/RefundIssuedEmail";
import { TrialEndingEmail, type TrialEndingEmailProps } from "../../../emails/TrialEndingEmail";

type TemplateMap = {
  Welcome: WelcomeEmailProps;
  PaymentFailed: PaymentFailedEmailProps;
  SubscriptionCancelled: SubscriptionCancelledEmailProps;
  RefundIssued: RefundIssuedEmailProps;
  TrialEnding: TrialEndingEmailProps;
};

type SendArgs<K extends keyof TemplateMap> = {
  to: string | string[];
  template: K;
  props: TemplateMap[K];
  subject?: string;
};

const subjects: Record<keyof TemplateMap, (p: TemplateMap[keyof TemplateMap]) => string> = {
  Welcome: () => `Welcome to ${config.app.name}`,
  PaymentFailed: () => `Payment failed — action required`,
  SubscriptionCancelled: () => `Your subscription was cancelled`,
  RefundIssued: () => `Refund issued`,
  TrialEnding: () => `Your ${config.app.name} Pro trial ends soon`,
};

/**
 * Thrown when Resend rejects a message. The SDK reports API failures in the returned
 * `error` field rather than throwing, so without this every caller that forgets to
 * check it fails silently — which is exactly how an unverified sending domain went
 * unnoticed. Callers decide whether a failed notification is fatal; they can no longer
 * decide it by accident.
 */
export class EmailSendError extends Error {
  constructor(
    readonly template: string,
    readonly reason: string,
  ) {
    super(`Resend rejected the ${template} email: ${reason}`);
    this.name = "EmailSendError";
  }
}

export async function sendEmail<K extends keyof TemplateMap>({ to, template, props, subject }: SendArgs<K>) {
  const element = renderTemplate(template, props);
  const html = await render(element);
  const resend = getResend();
  const { data, error } = await resend.emails.send({
    from: config.resend.from,
    to,
    subject: subject ?? subjects[template](props),
    html,
  });

  if (error) {
    throw new EmailSendError(template, `${error.name} — ${error.message}`);
  }
  return data;
}

function renderTemplate<K extends keyof TemplateMap>(template: K, props: TemplateMap[K]) {
  switch (template) {
    case "Welcome":
      return <WelcomeEmail {...(props as WelcomeEmailProps)} />;
    case "PaymentFailed":
      return <PaymentFailedEmail {...(props as PaymentFailedEmailProps)} />;
    case "SubscriptionCancelled":
      return <SubscriptionCancelledEmail {...(props as SubscriptionCancelledEmailProps)} />;
    case "RefundIssued":
      return <RefundIssuedEmail {...(props as RefundIssuedEmailProps)} />;
    case "TrialEnding":
      return <TrialEndingEmail {...(props as TrialEndingEmailProps)} />;
    default: {
      const _exhaustive: never = template;
      throw new Error(`Unknown template: ${String(_exhaustive)}`);
    }
  }
}
