/**
 * Webhook integration test driven by the real Stripe CLI.
 *
 * Requires:
 *   - `stripe` CLI on PATH
 *   - STRIPE_CLI_API_KEY (or STRIPE_API_KEY) — a test-mode secret/restricted
 *     key. `stripe sandbox create` provisions a throwaway one in seconds.
 *
 * The suite skips itself when either is missing, so it is safe in any CI.
 *
 * Flow: the real webhook route handler is served over local HTTP, then
 * `stripe listen --forward-to` delivers genuinely signed events produced by
 * `stripe trigger`. Supabase, Resend, and Sentry are replaced with in-memory
 * fakes; the Stripe API calls inside the handler are real.
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const apiKey = process.env.STRIPE_CLI_API_KEY ?? process.env.STRIPE_API_KEY ?? "";
const hasCli = spawnSync("stripe", ["--version"], { stdio: "ignore" }).status === 0;
const enabled = Boolean(apiKey) && hasCli;
if (!enabled) {
  console.warn(
    "[stripe-webhook-cli] skipped: needs the `stripe` CLI on PATH and STRIPE_CLI_API_KEY " +
      "(or STRIPE_API_KEY) set to a test-mode key. Hint: `stripe sandbox create`.",
  );
}

// In-memory stand-ins for Supabase tables, the Resend outbox, and Sentry.
const state = vi.hoisted(() => ({
  subscriptions: new Map<string, Record<string, unknown>>(),
  processedEvents: new Map<string, string>(),
  emails: [] as Array<{ to: string; template: string }>,
  errors: [] as unknown[],
}));

vi.mock("@/lib/supabase/admin", () => {
  const table = (name: string) => ({
    select(columns: string) {
      return {
        eq(_column: string, value: string) {
          const result = () => {
            if (name === "stripe_events") {
              return {
                data: state.processedEvents.has(value) ? { id: value } : null,
                error: null,
              };
            }
            if (name === "profiles") {
              // Every Stripe customer maps onto one fixture user.
              return columns.includes("email")
                ? { data: { email: "cli-test@example.com" }, error: null }
                : { data: { id: "user-cli-test" }, error: null };
            }
            return { data: null, error: null };
          };
          return {
            maybeSingle: async () => result(),
            single: async () => result(),
            limit: async () => ({ data: [], error: null }),
          };
        },
      };
    },
    upsert: async (row: { id: string; type?: string }) => {
      if (name === "stripe_events") state.processedEvents.set(row.id, row.type ?? "");
      if (name === "subscriptions") state.subscriptions.set(row.id, row);
      return { error: null };
    },
  });
  return { supabaseAdmin: () => ({ from: table }) };
});

vi.mock("@/lib/resend/send", () => ({
  sendEmail: async (args: { to: string; template: string }) => {
    state.emails.push({ to: args.to, template: args.template });
    return { id: "email-fake" };
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: (err: unknown) => {
    state.errors.push(err);
    console.error("[stripe-webhook-cli] Sentry.captureException:", err);
  },
}));

interface Delivery {
  status: number;
  json: { received?: boolean; duplicate?: boolean; error?: string } | null;
  rawBody: string;
  signature: string;
  eventType?: string;
  eventId?: string;
}

const deliveries: Delivery[] = [];
let webhookUrl = "";
let server: http.Server | undefined;
let listener: ChildProcessWithoutNullStreams | undefined;
let listenerLog = "";

function runStripe(args: string[], timeoutMs = 90_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("stripe", [...args, "--api-key", apiKey]);
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`stripe ${args[0]} timed out after ${timeoutMs}ms\n${out}`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`stripe ${args.join(" ")} exited ${code}\n${out}`));
    });
  });
}

async function waitUntil(check: () => boolean, what: string, timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${what}\n--- stripe listen log ---\n${listenerLog}`);
}

describe.skipIf(!enabled)("stripe webhook via CLI", () => {
  beforeAll(async () => {
    // The listen session's signing secret is stable per account+device, so it
    // can be fetched up front and wired into config before the route loads.
    // Match the token out of the output — CLI wrappers may prepend hint lines.
    const printSecret = await runStripe(["listen", "--print-secret"], 30_000);
    const secret = printSecret.match(/whsec_[A-Za-z0-9]+/)?.[0];
    expect(secret, `no whsec_ token in: ${printSecret}`).toBeTruthy();
    process.env.STRIPE_WEBHOOK_SECRET = secret!;
    process.env.STRIPE_SECRET_KEY = apiKey;

    // Import after env is final: config validates and freezes at module load.
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const { NextRequest } = await import("next/server");

    server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const rawBody = Buffer.concat(chunks).toString("utf8");

      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers[key] = value;
      }
      const request = new NextRequest(`http://127.0.0.1${req.url ?? "/"}`, {
        method: "POST",
        headers,
        body: rawBody,
      });

      const response = await POST(request);
      const text = await response.text();
      let event: { type?: string; id?: string } = {};
      try {
        event = JSON.parse(rawBody) as { type?: string; id?: string };
      } catch {
        /* unsigned probe bodies may not be JSON */
      }
      let json: Delivery["json"] = null;
      try {
        json = JSON.parse(text) as Delivery["json"];
      } catch {
        /* keep null */
      }
      deliveries.push({
        status: response.status,
        json,
        rawBody,
        signature: headers["stripe-signature"] ?? "",
        eventType: event.type,
        eventId: event.id,
      });
      res.writeHead(response.status, { "content-type": "application/json" });
      res.end(text);
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    webhookUrl = `http://127.0.0.1:${port}/api/stripe/webhook`;

    listener = spawn("stripe", ["listen", "--api-key", apiKey, "--forward-to", webhookUrl]);
    listener.stdout.on("data", (d) => (listenerLog += d));
    listener.stderr.on("data", (d) => (listenerLog += d));
    await waitUntil(() => listenerLog.includes("Ready!"), "stripe listen to become ready", 30_000);
  });

  afterAll(async () => {
    listener?.kill("SIGINT");
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  it("rejects an unsigned request with 400", async () => {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ping" }),
    });
    expect(res.status).toBe(400);
  });

  it("syncs a subscription from a real customer.subscription.created event", async () => {
    await runStripe(["trigger", "customer.subscription.created"]);
    await waitUntil(() => state.subscriptions.size > 0, "subscription row to be upserted");

    const row = [...state.subscriptions.values()][0];
    expect(row.user_id).toBe("user-cli-test");
    expect(String(row.id)).toMatch(/^sub_/);
    expect(String(row.price_id)).toMatch(/^price_/);
    expect(row.status).toBeTruthy();
    expect(typeof row.current_period_end).toBe("string");

    const hit = deliveries.find(
      (d) => d.eventType === "customer.subscription.created" && d.status === 200,
    );
    expect(hit, "signed event should reach the handler and return 200").toBeTruthy();
    expect(state.processedEvents.has(hit!.eventId!)).toBe(true);
  });

  it("treats a redelivery of the same signed event as a duplicate", async () => {
    const hit = deliveries.find(
      (d) => d.eventType === "customer.subscription.created" && d.status === 200,
    );
    expect(hit).toBeTruthy();

    // Same bytes, same signature — exactly what a Stripe retry sends.
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": hit!.signature },
      body: hit!.rawBody,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { duplicate?: boolean }).duplicate).toBe(true);
  });

  it("sends a payment-failed email on invoice.payment_failed", async () => {
    await runStripe(["trigger", "invoice.payment_failed"]);
    await waitUntil(
      () => state.emails.some((e) => e.template === "PaymentFailed"),
      "PaymentFailed email to be sent",
    );
    const email = state.emails.find((e) => e.template === "PaymentFailed");
    expect(email?.to).toBe("cli-test@example.com");
  });

  it("processed every relevant delivery without handler failures", () => {
    const failures = deliveries.filter((d) => d.status >= 500);
    expect(failures).toEqual([]);
    expect(state.errors).toEqual([]);
  });
});
