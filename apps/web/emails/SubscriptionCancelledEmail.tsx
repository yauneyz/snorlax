import { Body, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";

export type SubscriptionCancelledEmailProps = {
  appName: string;
  periodEnd: string;
};

export function SubscriptionCancelledEmail({ appName, periodEnd }: SubscriptionCancelledEmailProps) {
  const when = new Date(periodEnd).toLocaleDateString();
  return (
    <Html>
      <Head />
      <Preview>Your {appName} subscription is cancelled</Preview>
      <Body>
        <Container>
          <Heading>Subscription cancelled</Heading>
          <Text>
            Your {appName} subscription has been cancelled. You'll have access until {when}, then
            your account will lose paid features.
          </Text>
          <Text>If this was a mistake, sign in and resubscribe from the billing portal.</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default SubscriptionCancelledEmail;
