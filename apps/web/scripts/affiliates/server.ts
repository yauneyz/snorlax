/**
 * The affiliates admin app — local only, by construction.
 *
 *   pnpm affiliates            # production Supabase + live Stripe
 *   pnpm affiliates --dev      # local Supabase + test Stripe
 *   pnpm affiliates --port 4790 --no-open
 *
 * Like `pnpm comp`, there is deliberately no admin page or privileged endpoint in the deployed
 * web app: this process holds the Supabase secret key and the Stripe key, and it never leaves
 * this machine. The hardening is for other things running on this machine:
 *
 *   * It binds 127.0.0.1 only, so nothing off-box can reach it.
 *   * A random session token is minted per launch and handed over through the URL printed to
 *     the terminal; it becomes an HttpOnly SameSite=Strict cookie, and every API call needs it.
 *   * The Host header must be this exact loopback address, so a DNS-rebinding page can't talk
 *     to it, and writes must be same-origin JSON.
 *
 * Read-only toward Stripe: it lists charges for attributed customers and nothing else.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { z } from "zod";
import { STRIPE_API_VERSION } from "@talysman/billing-server";
import type { Database } from "../../src/lib/supabase/database.types";
import type { AffiliateReferralRow, AffiliateRow } from "../../src/lib/supabase/types";
import { resolveCompMode, type CompMode } from "../comp-environment";
import {
  owed,
  referralEarnings,
  sumCurrencies,
  type CurrencyCents,
  type ReferralEarnings,
} from "./earnings";
import { loadAffiliatesEnvironment, type AffiliatesEnvironment } from "./environment";

const SESSION_COOKIE = "affiliates_session";
const STRIPE_CONCURRENCY = 4;

type Flags = Record<string, string | boolean>;

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    if (name === "port") {
      flags.port = argv[i + 1] ?? "";
      i += 1;
    } else {
      flags[name] = true;
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Data

type Db = ReturnType<typeof createClient<Database>>;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function check<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new HttpError(500, result.error.message);
  if (result.data === null) throw new HttpError(404, "not found");
  return result.data;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}

type ReferralView = AffiliateReferralRow & {
  earnings: ReferralEarnings | null;
  stripeError: string | null;
};

async function earningsFor(
  stripe: Stripe | null,
  referral: AffiliateReferralRow,
  affiliate: AffiliateRow,
): Promise<Pick<ReferralView, "earnings" | "stripeError">> {
  if (!referral.stripe_customer_id) return { earnings: null, stripeError: null };
  if (!stripe) return { earnings: null, stripeError: "No Stripe key in .credentials" };
  try {
    const charges = await stripe.charges
      .list({ customer: referral.stripe_customer_id, limit: 100 })
      .autoPagingToArray({ limit: 10_000 });
    return {
      earnings: referralEarnings(charges, {
        attributedAt: referral.affiliate_at,
        commissionBps: affiliate.commission_bps,
        commissionMonths: affiliate.commission_months,
      }),
      stripeError: null,
    };
  } catch (error) {
    return { earnings: null, stripeError: error instanceof Error ? error.message : String(error) };
  }
}

async function loadState(db: Db, stripe: Stripe | null, environment: AffiliatesEnvironment) {
  const [affiliates, referrals, payouts] = await Promise.all([
    db.from("affiliates").select("*").order("created_at", { ascending: true }).then(check),
    db.from("affiliate_referrals").select("*").order("affiliate_at", { ascending: false }).then(check),
    db.from("affiliate_payouts").select("*").order("paid_at", { ascending: false }).then(check),
  ]);
  const byId = new Map(affiliates.map((affiliate) => [affiliate.id, affiliate]));

  const enriched: ReferralView[] = await mapLimit(referrals, STRIPE_CONCURRENCY, async (row) => ({
    ...row,
    ...(await earningsFor(stripe, row, byId.get(row.affiliate_id)!)),
  }));

  return {
    environment: {
      mode: environment.mode,
      label: environment.label,
      supabaseUrl: environment.supabaseUrl,
      stripe: stripe ? (environment.mode === "prod" ? "live" : "test") : null,
    },
    affiliates: affiliates.map((affiliate) => {
      const mine = enriched.filter((row) => row.affiliate_id === affiliate.id);
      const myPayouts = payouts.filter((payout) => payout.affiliate_id === affiliate.id);
      const commission = sumCurrencies(mine.map((row) => row.earnings?.commission ?? {}));
      const paid = myPayouts.reduce<CurrencyCents>((total, payout) => {
        total[payout.currency] = (total[payout.currency] ?? 0) + payout.amount_cents;
        return total;
      }, {});
      return {
        ...affiliate,
        link: `${environment.appUrl.replace(/\/$/, "")}/r/${affiliate.slug}`,
        stats: {
          visitors: mine.length,
          downloaded: mine.filter((row) => row.downloaded_at).length,
          installed: mine.filter((row) => row.installed_at).length,
          accounts: mine.filter((row) => row.signed_up_at).length,
          trials: mine.filter((row) => row.trial_at).length,
          customers: mine.filter(
            (row) =>
              row.paid_at ||
              row.lifetime_purchased_at ||
              Object.values(row.earnings?.eligible ?? {}).some((cents) => cents > 0),
          ).length,
        },
        revenue: sumCurrencies(mine.map((row) => row.earnings?.eligible ?? {})),
        commission,
        paid,
        owed: owed(commission, paid),
        stripeErrors: mine.filter((row) => row.stripeError).length,
        referrals: mine,
        payouts: myPayouts,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Validation

const optionalText = z
  .string()
  .trim()
  .max(2000)
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional();
const landingPath = z
  .string()
  .trim()
  .regex(/^\/([^/\\]|$)/, "must be an internal path like / or /pricing")
  .max(512);

const affiliateFields = {
  name: z.string().trim().min(1).max(200),
  contact: optionalText,
  notes: optionalText,
  landing_path: landingPath,
  commission_bps: z.number().int().min(0).max(10_000),
  commission_months: z.number().int().min(1).max(120),
  active: z.boolean(),
};

const createAffiliate = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9-]{1,39}$/, "2–40 chars: lowercase letters, digits, dashes"),
    ...affiliateFields,
  })
  .partial({ landing_path: true, commission_bps: true, commission_months: true, active: true })
  .strict();

const updateAffiliate = z.object(affiliateFields).partial().strict();

const createPayout = z
  .object({
    amount_cents: z.number().int().positive(),
    currency: z.string().trim().toLowerCase().regex(/^[a-z]{3}$/).default("usd"),
    paid_at: z.string().datetime({ offset: true }).optional(),
    note: optionalText,
  })
  .strict();

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HttpError(400, `${issue.path.join(".") || "body"}: ${issue.message}`);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// HTTP

function paletteCss(): string {
  const file = path.resolve(__dirname, "../../../../packages/shared/src/palette.json");
  const { colors } = JSON.parse(fs.readFileSync(file, "utf8")) as { colors: Record<string, string> };
  const declarations = Object.entries(colors).map(([name, hex]) => {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
    const variable = `--color-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
    return `  ${variable}: ${channels.join(" ")};`;
  });
  return `:root {\n${declarations.join("\n")}\n}`;
}

function readBody(request: http.IncomingMessage, limit = 16 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, "body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function cookieValue(request: http.IncomingMessage, name: string): string | undefined {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

function sameToken(a: string | undefined | null, b: string): boolean {
  if (!a) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function send(response: http.ServerResponse, status: number, body: unknown, type = "application/json") {
  response.writeHead(status, {
    "Content-Type": `${type}; charset=utf-8`,
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    ...(type === "text/html"
      ? {
          "Content-Security-Policy":
            "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; " +
            "img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        }
      : {}),
  });
  response.end(typeof body === "string" ? body : JSON.stringify(body));
}

function openBrowser(url: string) {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  try {
    spawn(command, [url], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  } catch {
    // The URL is printed either way.
  }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const mode: CompMode = resolveCompMode(flags);
  const port = flags.port === undefined ? 4777 : Number(flags.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("--port must be a number between 1024 and 65535.");
  }

  const environment = loadAffiliatesEnvironment(mode);
  const db = createClient<Database>(environment.supabaseUrl, environment.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const stripe = environment.stripeSecretKey
    ? new Stripe(environment.stripeSecretKey, { apiVersion: STRIPE_API_VERSION })
    : null;

  const token = crypto.randomBytes(24).toString("base64url");
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const page = fs
    .readFileSync(path.join(__dirname, "page.html"), "utf8")
    .replace("/* PALETTE */", paletteCss());
  const script = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

  const server = http.createServer(async (request, response) => {
    try {
      const host = request.headers.host ?? "";
      if (!allowedHosts.has(host)) throw new HttpError(421, "unexpected Host header");
      const url = new URL(request.url ?? "/", `http://${host}`);

      // Hand-over: the printed URL carries the token once; it becomes a cookie.
      const offered = url.searchParams.get("token");
      if (request.method === "GET" && url.pathname === "/" && offered) {
        if (!sameToken(offered, token)) throw new HttpError(401, "stale link — use the URL printed by this run");
        response.writeHead(303, {
          Location: "/",
          "Set-Cookie": `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`,
          "Cache-Control": "no-store",
        });
        response.end();
        return;
      }

      if (!sameToken(cookieValue(request, SESSION_COOKIE), token)) {
        if (url.pathname === "/") {
          send(response, 401, "Open the URL printed in the terminal by `pnpm affiliates`.", "text/plain");
          return;
        }
        throw new HttpError(401, "not signed in");
      }

      if (request.method !== "GET") {
        const origin = request.headers.origin;
        if (origin && origin !== `http://${host}`) throw new HttpError(403, "cross-origin write");
        if (!request.headers["content-type"]?.startsWith("application/json")) {
          throw new HttpError(415, "JSON only");
        }
      }

      const route = `${request.method} ${url.pathname}`;
      let match: RegExpMatchArray | null;

      if (route === "GET /") return send(response, 200, page, "text/html");
      if (route === "GET /app.js") return send(response, 200, script, "text/javascript");
      if (route === "GET /api/state") return send(response, 200, await loadState(db, stripe, environment));

      if (route === "POST /api/affiliates") {
        const input = parse(createAffiliate, await readBody(request));
        const { data, error } = await db.from("affiliates").insert(input).select().single();
        if (error?.code === "23505") throw new HttpError(409, `slug "${input.slug}" is taken`);
        return send(response, 201, check({ data, error }));
      }

      if ((match = route.match(/^PATCH \/api\/affiliates\/([0-9a-f-]{36})$/))) {
        const input = parse(updateAffiliate, await readBody(request));
        const updated = await db
          .from("affiliates")
          .update({ ...input, updated_at: new Date().toISOString() })
          .eq("id", match[1])
          .select()
          .single();
        return send(response, 200, check(updated));
      }

      if ((match = route.match(/^POST \/api\/affiliates\/([0-9a-f-]{36})\/payouts$/))) {
        const input = parse(createPayout, await readBody(request));
        const created = await db
          .from("affiliate_payouts")
          .insert({ ...input, affiliate_id: match[1] })
          .select()
          .single();
        return send(response, 201, check(created));
      }

      if ((match = route.match(/^DELETE \/api\/payouts\/([0-9a-f-]{36})$/))) {
        check(await db.from("affiliate_payouts").delete().eq("id", match[1]).select("id"));
        return send(response, 200, { ok: true });
      }

      throw new HttpError(404, "not found");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      if (status === 500) console.error(error);
      send(response, status, { error: message });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}/?token=${token}`;
    console.log(`→ ${environment.label}: ${environment.supabaseUrl}`);
    console.log(
      environment.stripeSecretKey
        ? `→ Stripe ${mode === "prod" ? "live" : "test"} key (read-only use: listing charges)`
        : "→ No Stripe key for this mode: earnings will show as unavailable",
    );
    console.log(`\n  Affiliates admin: ${url}\n\n  Bound to 127.0.0.1 only. Ctrl-C to stop.`);
    if (!flags["no-open"]) openBrowser(url);
  });
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
