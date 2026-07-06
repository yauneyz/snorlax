/**
 * Next.js hooks this at server + edge startup. Used to bootstrap Sentry for
 * each runtime. The matching client bundle is loaded by `sentry.client.config.ts`.
 */
import { isSentryEnabled } from "./lib/sentry/config";

export async function register() {
  if (!isSentryEnabled()) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export async function onRequestError(err: unknown) {
  if (!isSentryEnabled()) return;

  const { captureException } = await import("./lib/sentry");
  await captureException(err);
}
