import { Body, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";

export type WelcomeEmailProps = {
  appName: string;
  userName?: string;
};

export function WelcomeEmail({ appName, userName }: WelcomeEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Welcome to {appName}</Preview>
      <Body>
        <Container>
          <Heading>Welcome{userName ? `, ${userName}` : ""}.</Heading>
          <Text>Thanks for signing up for {appName}. We're glad you're here.</Text>
          <Text>Reply to this email if you have any questions.</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default WelcomeEmail;
