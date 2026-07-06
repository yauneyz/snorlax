import { isSentryEnabled } from "./config";

export async function captureException(err: unknown, context?: Record<string, unknown>) {
  if (!isSentryEnabled()) return;

  const Sentry = await import("@sentry/nextjs");
  Sentry.captureException(err, context ? { extra: context } : undefined);
}

export { isSentryEnabled, normalizeSentryDsn } from "./config";
