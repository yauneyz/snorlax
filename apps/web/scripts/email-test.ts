/**
 * Live Resend smoke test.
 *
 * Renders the real transactional templates and sends them through the production
 * Resend account — the same API key, the same `from` identity, and the same
 * render → `resend.emails.send` path as src/lib/resend/send.tsx. Nothing here is
 * mocked, so a green run means the API key is valid, the sending domain is
 * verified, and every template renders to deliverable HTML.
 *
 * Credentials come straight from `.credentials` rather than a generated
 * .env.local, so the test always exercises the real integration even on a
 * machine synced with `--dummy` placeholders.
 *
 * Usage (from the repository root):
 *   pnpm web:test:email                     # one Welcome email to email_test_address
 *   pnpm web:test:email --all               # every template
 *   pnpm web:test:email --template TrialEnding
 *   pnpm web:test:email --to me@example.com
 *   pnpm web:test:email --all --dry-run     # render only, send nothing
 *
 * Subjects and props mirror src/lib/resend/send.tsx; keep the two in step when a
 * template is added or renamed.
 */
import fs from "node:fs";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import toml from "@iarna/toml";
import { z } from "zod";
import { render } from "@react-email/components";
import { Resend } from "resend";

import { WelcomeEmail } from "../emails/WelcomeEmail";
import { PaymentFailedEmail } from "../emails/PaymentFailedEmail";
import { SubscriptionCancelledEmail } from "../emails/SubscriptionCancelledEmail";
import { RefundIssuedEmail } from "../emails/RefundIssuedEmail";
import { TrialEndingEmail } from "../emails/TrialEndingEmail";

const ROOT = path.resolve(__dirname, "../../..");

const credentialsSchema = z.object({
  app: z.object({
    name: z.string().min(1),
    url_prod: z.string().url(),
  }),
  resend: z.object({
    api_key: z.string().min(1),
    from: z.string().min(1),
    email_test_address: z.union([z.string().email(), z.literal("")]).optional().default(""),
  }),
});

type Credentials = z.infer<typeof credentialsSchema>;

type Sample = {
  subject: (c: Credentials) => string;
  element: (c: Credentials) => ReactElement;
};

/** Representative props per template — the values a real send would carry. */
const SAMPLES = {
  Welcome: {
    subject: (c) => `Welcome to ${c.app.name}`,
    element: (c) => createElement(WelcomeEmail, { appName: c.app.name, userName: "Resend Test" }),
  },
  PaymentFailed: {
    subject: () => "Payment failed — action required",
    element: (c) =>
      createElement(PaymentFailedEmail, {
        appName: c.app.name,
        invoiceUrl: `${c.app.url_prod}/account`,
        amount: 1000,
        currency: "usd",
      }),
  },
  SubscriptionCancelled: {
    subject: () => "Your subscription was cancelled",
    element: (c) =>
      createElement(SubscriptionCancelledEmail, {
        appName: c.app.name,
        periodEnd: inDays(30),
      }),
  },
  RefundIssued: {
    subject: () => "Refund issued",
    element: (c) => createElement(RefundIssuedEmail, { appName: c.app.name, amount: 1000, currency: "usd" }),
  },
  TrialEnding: {
    subject: (c) => `Your ${c.app.name} Pro trial ends soon`,
    element: (c) =>
      createElement(TrialEndingEmail, {
        appName: c.app.name,
        trialEnd: inDays(3),
        accountUrl: `${c.app.url_prod}/account`,
      }),
  },
} satisfies Record<string, Sample>;

type TemplateName = keyof typeof SAMPLES;

const TEMPLATE_NAMES = Object.keys(SAMPLES) as TemplateName[];

function inDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function die(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

type Args = {
  to?: string;
  templates: TemplateName[];
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  let to: string | undefined;
  let all = false;
  let dryRun = false;
  const templates: TemplateName[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const [name, inline] = token.startsWith("--") ? token.slice(2).split("=") : [token, undefined];
    const value = () => {
      const next = inline ?? argv[i + 1];
      if (!next || next.startsWith("--")) die(`--${name} requires a value.`);
      if (inline === undefined) i += 1;
      return next;
    };

    switch (name) {
      case "to":
        to = value();
        break;
      case "template": {
        const requested = value();
        const match = TEMPLATE_NAMES.find((t) => t.toLowerCase() === requested.toLowerCase());
        if (!match) die(`Unknown template "${requested}". Known: ${TEMPLATE_NAMES.join(", ")}`);
        templates.push(match);
        break;
      }
      case "all":
        all = true;
        break;
      case "dry-run":
        dryRun = true;
        break;
      case "help":
        console.log(
          `usage: pnpm web:test:email [--to <address>] [--all | --template <${TEMPLATE_NAMES.join("|")}>] [--dry-run]`,
        );
        process.exit(0);
      default:
        die(`Unexpected argument "${token}".`);
    }
  }

  if (all && templates.length > 0) die("Choose either --all or --template, not both.");
  return { to, templates: all ? TEMPLATE_NAMES : templates.length > 0 ? templates : ["Welcome"], dryRun };
}

function loadCredentials(): Credentials {
  const candidates = [
    path.join(ROOT, ".credentials"),
    path.resolve(ROOT, "..", "indigo", ".credentials"),
  ];
  const source = candidates.find((candidate) => fs.existsSync(candidate));
  if (!source) die(`Missing .credentials. Checked:\n${candidates.join("\n")}`);

  let parsed: unknown;
  try {
    parsed = toml.parse(fs.readFileSync(source, "utf8"));
  } catch (error) {
    die(`Could not read ${path.relative(ROOT, source)}: ${asMessage(error)}`);
  }

  const result = credentialsSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`);
    die(`.credentials is missing Resend configuration:\n${issues.join("\n")}`);
  }
  return result.data;
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const credentials = loadCredentials();

  const to = args.to ?? process.env.RESEND_TEST_ADDRESS ?? credentials.resend.email_test_address;
  if (!to) {
    die("No recipient. Set [resend] email_test_address in .credentials or pass --to <address>.");
  }

  console.log(`› from: ${credentials.resend.from}`);
  console.log(`› to:   ${to}`);
  console.log(`› templates: ${args.templates.join(", ")}${args.dryRun ? " (dry run)" : ""}`);

  const resend = new Resend(credentials.resend.api_key);
  let failures = 0;

  for (const template of args.templates) {
    const sample: Sample = SAMPLES[template];
    const subject = sample.subject(credentials);

    let html: string;
    try {
      // @react-email/components carries its own React 18 types, so its ReactElement is
      // nominally distinct from the React 19 one createElement returns. JSX callers hide
      // this; here the cast does. Structurally the two are the same element.
      html = await render(sample.element(credentials) as Parameters<typeof render>[0]);
    } catch (error) {
      console.error(`✗ ${template}: render failed — ${asMessage(error)}`);
      failures += 1;
      continue;
    }

    if (args.dryRun) {
      console.log(`✓ ${template}: rendered ${html.length} bytes — "${subject}" (not sent)`);
      continue;
    }

    const { data, error } = await resend.emails.send({
      from: credentials.resend.from,
      to,
      subject,
      html,
    });

    if (error) {
      console.error(`✗ ${template}: ${error.name} — ${error.message}`);
      failures += 1;
      continue;
    }
    console.log(`✓ ${template}: queued as ${data?.id} — "${subject}"`);
  }

  if (failures > 0) {
    die(`${failures} of ${args.templates.length} template(s) failed.`);
  }
  console.log(
    args.dryRun
      ? `› rendered ${args.templates.length} template(s); nothing sent.`
      : `› sent ${args.templates.length} email(s) to ${to}. Check the inbox and the Resend dashboard.`,
  );
}

main().catch((error) => die(asMessage(error)));
