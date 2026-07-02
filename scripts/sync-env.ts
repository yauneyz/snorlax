/**
 * Reads the monorepo `.credentials` TOML file and writes environment files for both:
 *   - apps/web/.env.local, with server/web variables
 *   - .env.local, with desktop-safe public variables only
 *
 * During migration, the script also accepts ../indigo/.credentials so existing local
 * credentials can be reused without copying secrets into the repo.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import toml from "@iarna/toml";
import { z } from "zod";

const ROOT = path.resolve(__dirname, "..");
const WEB_DIR = path.join(ROOT, "apps", "web");
const ROOT_ENV_OUT = path.join(ROOT, ".env.local");
const WEB_ENV_OUT = path.join(WEB_DIR, ".env.local");

const CREDENTIALS_CANDIDATES = [
  path.join(ROOT, ".credentials"),
  path.resolve(ROOT, "..", "indigo", ".credentials"),
];

const EXAMPLE_CANDIDATES = [
  path.join(ROOT, ".credentials.example"),
  path.join(WEB_DIR, ".credentials.example"),
];

const supabaseProjectUrl = z
  .string()
  .url()
  .transform((value) => {
    const url = new URL(value);
    const servicePath = /\/(?:rest|auth|storage|functions|realtime)\/v\d+\/?$/;
    url.pathname = url.pathname.replace(servicePath, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  });

const optionalPosthogKey = z
  .string()
  .optional()
  .default("")
  .transform((value) => {
    const trimmed = value.trim();
    return trimmed.includes("...") ? "" : trimmed;
  });

const extensionHostingBlock = z.object({
  bucket: z.string().min(1),
  public_s3_base_url: z.string().url(),
});

const optionalUrl = z.union([z.string().url(), z.literal("")]).optional().default("");

const extensionStoresBlock = z
  .object({
    chrome_url: optionalUrl,
    edge_url: optionalUrl,
    firefox_url: optionalUrl,
  })
  .optional()
  .default({
    chrome_url: "",
    edge_url: "",
    firefox_url: "",
  });

const supabaseBlock = z.object({
  url: supabaseProjectUrl,
  publishable_key: z.string().min(1),
  secret_key: z.string().min(1),
  project_ref: z.string().min(1),
});

const credentialsSchema = z.object({
  app: z.object({
    name: z.string().min(1),
    url_dev: z.string().url(),
    url_prod: z.string().url(),
  }),
  supabase: z.object({
    dev: supabaseBlock,
    prod: supabaseBlock,
  }),
  stripe: z.object({
    mode: z.enum(["test", "live"]),
    publishable_key_test: z.string().min(1),
    secret_key_test: z.string().min(1),
    webhook_secret_test: z.string().min(1),
    publishable_key_live: z.string().min(1).optional().or(z.literal("")),
    secret_key_live: z.string().min(1).optional().or(z.literal("")),
    webhook_secret_live: z.string().min(1).optional().or(z.literal("")),
    price_id_monthly: z.string().min(1),
    price_id_yearly: z.string().min(1),
    portal_configuration_id: z.string().optional().default(""),
  }),
  resend: z.object({
    api_key: z.string().min(1),
    from: z.string().min(1),
  }),
  sentry: z.object({
    dsn: z.string().min(1).optional().default(""),
    org: z.string().optional().default(""),
    project: z.string().optional().default(""),
    auth_token: z.string().optional().default(""),
  }),
  posthog: z.object({
    key: optionalPosthogKey,
    host: z.string().optional().default("https://us.i.posthog.com"),
  }),
  google: z.object({
    ga4_measurement_id: z.string().optional().default(""),
    search_console_verification: z.string().optional().default(""),
    oauth_client_id: z.string().optional().default(""),
    oauth_client_secret: z.string().optional().default(""),
  }),
  aws: z.object({
    region: z.string().min(1),
    access_key_id: z.string().min(1),
    secret_access_key: z.string().min(1),
  }),
  extension_hosting: extensionHostingBlock,
  extension_stores: extensionStoresBlock,
  openai: z.object({
    api_key: z.string().optional().default(""),
    default_model: z.string().min(1).default("gpt-5.1"),
    organization: z.string().optional().default(""),
    base_url: z.string().optional().default(""),
  }),
  local_llm: z
    .object({
      endpoint: z.string().url().default("http://127.0.0.1:11434/v1/chat/completions"),
      model: z.string().min(1).default("qwen3-14b-awq"),
      api_key: z.string().optional().default(""),
    })
    .optional()
    .default({
      endpoint: "http://127.0.0.1:11434/v1/chat/completions",
      model: "qwen3-14b-awq",
      api_key: "",
    }),
  security: z.object({
    token_encryption_key: z.string().regex(/^[A-Za-z0-9+/=]{43,}$/, {
      message: "token_encryption_key must be base64 of at least 32 bytes",
    }),
    oauth_state_secret: z.string().min(32, {
      message: "oauth_state_secret must be at least 32 characters",
    }),
  }),
});

type Credentials = z.infer<typeof credentialsSchema>;
type Mode = "dev" | "prod";

const isVercelBuild = process.env.VERCEL === "1";
const isProductionPush = process.argv.includes("--production");
const skipOnVercel = process.argv.includes("--skip-on-vercel");

function resolveMode(): Mode {
  if (isProductionPush || process.argv.includes("--prod")) return "prod";
  const flag = process.argv.find((arg) => arg.startsWith("--mode="));
  if (!flag) return "dev";
  const value = flag.slice("--mode=".length);
  if (value === "dev" || value === "prod") return value;
  console.error(`Invalid --mode=${value}. Expected "dev" or "prod".`);
  process.exit(1);
}

function firstExisting(paths: string[]): string | null {
  return paths.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function loadCredentials(): Credentials | null {
  if (skipOnVercel && isVercelBuild && !firstExisting(CREDENTIALS_CANDIDATES)) {
    console.log("Vercel build detected; using Vercel environment variables.");
    return null;
  }

  let source = firstExisting(CREDENTIALS_CANDIDATES);
  if (!source) {
    if (isVercelBuild || isProductionPush || process.env.CI === "true") {
      console.error(`Missing .credentials. Checked:\n${CREDENTIALS_CANDIDATES.join("\n")}`);
      console.error("Refusing to fall back to example credentials in CI/production.");
      process.exit(1);
    }

    source = firstExisting(EXAMPLE_CANDIDATES);
    if (!source) {
      console.error(`Missing .credentials and no .credentials.example fallback. Checked:\n${[
        ...CREDENTIALS_CANDIDATES,
        ...EXAMPLE_CANDIDATES,
      ].join("\n")}`);
      process.exit(1);
    }

    console.warn(`.credentials not found; syncing from ${path.relative(ROOT, source)}.`);
    console.warn("Create a real .credentials for anything beyond local smoke tests.");
  }

  const raw = fs.readFileSync(source, "utf8");
  const parsed = toml.parse(raw);
  const result = credentialsSchema.safeParse(parsed);
  if (!result.success) {
    console.error(".credentials failed validation:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

function stripeValues(c: Credentials) {
  return {
    publishableKey:
      c.stripe.mode === "live" ? c.stripe.publishable_key_live : c.stripe.publishable_key_test,
    secretKey: c.stripe.mode === "live" ? c.stripe.secret_key_live : c.stripe.secret_key_test,
    webhookSecret:
      c.stripe.mode === "live" ? c.stripe.webhook_secret_live : c.stripe.webhook_secret_test,
  };
}

function toWebEnvPairs(c: Credentials, mode: Mode): Array<[string, string]> {
  const stripe = stripeValues(c);
  const supabase = c.supabase[mode];
  const appUrl = mode === "prod" ? c.app.url_prod : c.app.url_dev;
  const appEnvironment = mode === "prod" ? "production" : "development";
  const llmProvider = mode === "prod" ? "openai" : "local";

  return [
    ["NEXT_PUBLIC_APP_URL", appUrl],
    ["NEXT_PUBLIC_APP_NAME", c.app.name],
    ["APP_ENVIRONMENT", appEnvironment],

    ["NEXT_PUBLIC_SUPABASE_URL", supabase.url],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", supabase.publishable_key],
    ["SUPABASE_SECRET_KEY", supabase.secret_key],
    ["SUPABASE_PROJECT_REF", supabase.project_ref],

    ["STRIPE_MODE", c.stripe.mode],
    ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", stripe.publishableKey ?? ""],
    ["STRIPE_SECRET_KEY", stripe.secretKey ?? ""],
    ["STRIPE_WEBHOOK_SECRET", stripe.webhookSecret ?? ""],
    ["STRIPE_PRICE_MONTHLY", c.stripe.price_id_monthly],
    ["STRIPE_PRICE_YEARLY", c.stripe.price_id_yearly],
    ["STRIPE_PORTAL_CONFIG_ID", c.stripe.portal_configuration_id ?? ""],

    ["RESEND_API_KEY", c.resend.api_key],
    ["RESEND_FROM", c.resend.from],

    ["NEXT_PUBLIC_SENTRY_DSN", c.sentry.dsn],
    ["SENTRY_ORG", c.sentry.org],
    ["SENTRY_PROJECT", c.sentry.project],
    ["SENTRY_AUTH_TOKEN", c.sentry.auth_token],

    ["NEXT_PUBLIC_POSTHOG_KEY", c.posthog.key],
    ["NEXT_PUBLIC_POSTHOG_HOST", c.posthog.host],

    ["NEXT_PUBLIC_GA4_MEASUREMENT_ID", c.google.ga4_measurement_id],
    ["GOOGLE_SITE_VERIFICATION", c.google.search_console_verification],
    ["GOOGLE_OAUTH_CLIENT_ID", c.google.oauth_client_id],
    ["GOOGLE_OAUTH_CLIENT_SECRET", c.google.oauth_client_secret],

    ["EXTENSION_ARTIFACTS_BUCKET", c.extension_hosting.bucket],
    ["EXTENSION_ARTIFACTS_REGION", c.aws.region],
    ["EXTENSION_PUBLIC_S3_BASE_URL", c.extension_hosting.public_s3_base_url],
    ["EXTENSION_CHROME_STORE_URL", c.extension_stores.chrome_url],
    ["EXTENSION_EDGE_STORE_URL", c.extension_stores.edge_url],
    ["EXTENSION_FIREFOX_STORE_URL", c.extension_stores.firefox_url],

    ["LLM_PROVIDER", llmProvider],

    ["OPENAI_API_KEY", c.openai.api_key],
    ["OPENAI_DEFAULT_MODEL", c.openai.default_model],
    ["OPENAI_ORGANIZATION", c.openai.organization],
    ["OPENAI_BASE_URL", c.openai.base_url],

    ["LOCAL_LLM_ENDPOINT", c.local_llm.endpoint],
    ["LOCAL_LLM_MODEL", c.local_llm.model],
    ["LOCAL_LLM_API_KEY", c.local_llm.api_key],

    ["TOKEN_ENCRYPTION_KEY", c.security.token_encryption_key],
    ["OAUTH_STATE_SECRET", c.security.oauth_state_secret],
  ];
}

function toDesktopEnvPairs(c: Credentials, mode: Mode): Array<[string, string]> {
  const stripe = stripeValues(c);
  const supabase = c.supabase[mode];
  const appUrl = mode === "prod" ? c.app.url_prod : c.app.url_dev;
  const appEnvironment = mode === "prod" ? "production" : "development";

  return [
    ["APP_ENV", appEnvironment],
    ["TALYSMAN_PIPE", mode === "prod" ? "talysman" : "talysman-dev"],
    ["VITE_SUPABASE_URL", supabase.url],
    ["VITE_SUPABASE_ANON_KEY", supabase.publishable_key],
    ["VITE_STRIPE_PUBLISHABLE_KEY", stripe.publishableKey ?? ""],
    ["VITE_PAYMENT_URL", appUrl],
    ["API_BASE_URL", appUrl],
    ["UPDATE_FEED_URL", ""],
  ];
}

function writeEnvFile(filePath: string, pairs: Array<[string, string]>, mode: Mode) {
  const header = [
    "# GENERATED by scripts/sync-env.ts - do not edit by hand.",
    "# Source of truth is .credentials at the monorepo root.",
    `# mode=${mode}`,
    "",
  ];
  const body = pairs.map(([key, value]) => `${key}=${quote(value)}`);
  fs.writeFileSync(filePath, header.concat(body).join("\n") + "\n", "utf8");
  console.log(`wrote ${path.relative(ROOT, filePath)} (mode=${mode}, ${pairs.length} vars)`);
}

function quote(value: string): string {
  if (value === "") return '""';
  if (/[\s"'#=\\]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function pushToVercel(pairs: Array<[string, string]>) {
  for (const [name, value] of pairs) {
    if (value === "") {
      console.log(`  - skipping empty ${name}`);
      continue;
    }
    console.log(`  - pushing ${name} to Vercel production`);
    const res = spawnSync("vercel", ["env", "add", name, "production"], {
      input: value + "\n",
      stdio: ["pipe", "inherit", "inherit"],
      encoding: "utf8",
    });
    if (res.status !== 0) {
      console.error(
        `failed to push ${name}. If it already exists, remove it first with: vercel env rm ${name} production`,
      );
      process.exit(res.status ?? 1);
    }
  }
  console.log("pushed web env vars to Vercel production.");
}

function main() {
  const mode = resolveMode();
  const creds = loadCredentials();
  if (!creds) return;

  if (mode === "prod" && creds.openai.api_key.length === 0) {
    console.error("openai.api_key is required for prod mode because prod uses OpenAI.");
    process.exit(1);
  }

  const webPairs = toWebEnvPairs(creds, mode);
  if (isProductionPush) {
    pushToVercel(webPairs);
    return;
  }

  writeEnvFile(WEB_ENV_OUT, webPairs, mode);
  writeEnvFile(ROOT_ENV_OUT, toDesktopEnvPairs(creds, mode), mode);
}

main();
