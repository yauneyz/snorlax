import * as Sentry from "@sentry/nextjs";

export function captureException(err: unknown, context?: Record<string, unknown>) {
  Sentry.captureException(err, context ? { extra: context } : undefined);
}

export { Sentry };
