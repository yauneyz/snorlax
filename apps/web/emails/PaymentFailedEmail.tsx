import { Body, Button, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";

export type PaymentFailedEmailProps = {
  appName: string;
  invoiceUrl: string;
  amount: number;
  currency: string;
};

export function PaymentFailedEmail({ appName, invoiceUrl, amount, currency }: PaymentFailedEmailProps) {
  const formatted = (amount / 100).toLocaleString(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  });
  return (
    <Html>
      <Head />
      <Preview>{appName}: your payment failed</Preview>
      <Body>
        <Container>
          <Heading>Your payment failed</Heading>
          <Text>
            We couldn&apos;t charge your card for {formatted}. Please update your payment method to keep
            your {appName} subscription active.
          </Text>
          <Button href={invoiceUrl}>Update payment</Button>
        </Container>
      </Body>
    </Html>
  );
}

export default PaymentFailedEmail;
