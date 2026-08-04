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

export async function sendEmail<K extends keyof TemplateMap>({ to, template, props, subject }: SendArgs<K>) {
  const element = renderTemplate(template, props);
  const html = await render(element);
  const resend = getResend();
  return resend.emails.send({
    from: config.resend.from,
    to,
    subject: subject ?? subjects[template](props),
    html,
  });
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
