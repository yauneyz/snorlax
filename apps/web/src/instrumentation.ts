/**
 * Next.js hooks this at server + edge startup. Used to bootstrap Sentry for
 * each runtime. The matching client bundle is loaded by `sentry.client.config.ts`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export async function onRequestError(err: unknown) {
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureException(err);
}
