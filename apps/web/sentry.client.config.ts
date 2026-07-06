import * as Sentry from "@sentry/nextjs";
import { normalizeSentryDsn } from "./src/lib/sentry/config";

const dsn = normalizeSentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.APP_ENVIRONMENT ?? "development",
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    integrations: [Sentry.replayIntegration()],
  });
}
