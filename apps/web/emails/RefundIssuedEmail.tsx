import { Body, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";

export type RefundIssuedEmailProps = {
  appName: string;
  amount: number;
  currency: string;
};

export function RefundIssuedEmail({ appName, amount, currency }: RefundIssuedEmailProps) {
  const formatted = (amount / 100).toLocaleString(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  });
  return (
    <Html>
      <Head />
      <Preview>{appName}: refund issued</Preview>
      <Body>
        <Container>
          <Heading>Refund issued</Heading>
          <Text>We refunded {formatted} to your original payment method. It may take a few business days to appear.</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default RefundIssuedEmail;
