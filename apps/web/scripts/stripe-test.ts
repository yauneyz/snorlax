/**
 * Local webhook harness.
 *
 * Usage:
 *   1. `pnpm dev` in another terminal.
 *   2. `pnpm stripe:test`
 *
 * Spawns `stripe listen --forward-to http://localhost:3000/api/stripe/webhook`
 * and then, for each event in EVENTS, runs `stripe trigger <event>`. You can
 * watch the webhook log line by line and confirm each event succeeds.
 */
import { spawn, spawnSync } from "node:child_process";

const EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "charge.refunded",
];

function ensureStripeCli() {
  const r = spawnSync("stripe", ["--version"], { stdio: "ignore" });
  if (r.status !== 0) {
    console.error("✖ Stripe CLI not found. Install: https://stripe.com/docs/stripe-cli");
    process.exit(1);
  }
}

function main() {
  ensureStripeCli();
  const url = process.env.WEBHOOK_URL ?? "http://localhost:3000/api/stripe/webhook";
  console.log(`› forwarding to ${url}`);

  const listener = spawn("stripe", ["listen", "--forward-to", url], { stdio: "inherit" });

  process.on("SIGINT", () => {
    listener.kill("SIGINT");
    process.exit(0);
  });

  // Small delay so `stripe listen` is ready.
  setTimeout(() => {
    for (const event of EVENTS) {
      console.log(`› triggering ${event}`);
      const r = spawnSync("stripe", ["trigger", event], { stdio: "inherit" });
      if (r.status !== 0) console.warn(`⚠ trigger ${event} returned non-zero`);
    }
    console.log("› done triggering. Ctrl+C to stop listener.");
  }, 2000);
}

main();
