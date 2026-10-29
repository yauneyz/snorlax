import { Body, Button, Container, Head, Heading, Html, Link, Preview, Text } from "@react-email/components";

export type PaymentFailedEmailProps = {
  appName: string;
  /** Opens the billing portal's card form; the new card is used for every future renewal. */
  updateCardUrl: string;
  /** Confirmation page — the link itself never cancels, so a link scanner can't. */
  cancelUrl: string;
  /** Stripe's hosted invoice page: settles this one invoice only. */
  invoiceUrl: string | null;
  amount: number;
  currency: string;
};

export function PaymentFailedEmail({
  appName,
  updateCardUrl,
  cancelUrl,
  invoiceUrl,
  amount,
  currency,
}: PaymentFailedEmailProps) {
  const formatted = (amount / 100).toLocaleString(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  });
  return (
    <Html>
      <Head />
      <Preview>Your {appName} Pro renewal didn&apos;t go through — no rush, here are your options</Preview>
      <Body>
        <Container>
          <Heading>Your renewal didn&apos;t go through</Heading>
          <Text>Hi there,</Text>
          <Text>
            We tried to renew your {appName} Pro subscription for {formatted}, but your bank
            declined the payment. It happens — cards expire, balances run low, banks get cautious.
            We&apos;ll try again automatically over the next few days.
          </Text>
          <Text>If you&apos;d like to keep Pro going on a different card, you can switch it here:</Text>
          <Button href={updateCardUrl}>Update my card</Button>
          {invoiceUrl ? (
            <Text>
              Or, to settle just this renewal,{" "}
              <Link href={invoiceUrl}>pay the invoice directly</Link>.
            </Text>
          ) : null}
          <Text>
            And if you no longer want {appName} Pro, that&apos;s completely fine — you can simply
            ignore this email. Or <Link href={cancelUrl}>click here to cancel</Link> and
            we&apos;ll stop trying right away. Either way you keep {appName} Free.
          </Text>
          <Text>Thanks for using {appName}.</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default PaymentFailedEmail;
