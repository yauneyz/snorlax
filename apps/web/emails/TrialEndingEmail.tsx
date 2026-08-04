import { Body, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";

export type TrialEndingEmailProps = {
  appName: string;
  /** ISO timestamp of the trial's end — Stripe's `trial_end`, not a locally computed date. */
  trialEnd: string;
  accountUrl: string;
};

export function TrialEndingEmail({ appName, trialEnd, accountUrl }: TrialEndingEmailProps) {
  const when = new Date(trialEnd).toLocaleDateString();
  return (
    <Html>
      <Head />
      <Preview>Your {appName} Pro trial ends {when}</Preview>
      <Body>
        <Container>
          <Heading>Your Pro trial ends {when}</Heading>
          <Text>
            Your free trial of {appName} Pro ends on {when}, and your first payment will be
            charged then. Nothing has been charged so far.
          </Text>
          <Text>
            If Pro is earning its place, you don&apos;t need to do anything — unlimited blocking,
            app blocking, and your recurring schedules keep running.
          </Text>
          <Text>
            If it isn&apos;t, cancel before {when} and you won&apos;t be charged at all. You can
            cancel in one click from your account page: {accountUrl}
          </Text>
          <Text>
            Cancelling drops you to {appName} Free, which keeps key-gated focus sessions. Note
            that scheduled windows and extra blocking profiles are removed on the way down.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default TrialEndingEmail;
