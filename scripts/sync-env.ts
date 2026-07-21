/**
 * Reads the monorepo `.credentials` TOML file (plus any referenced Google OAuth JSON) and
 * writes environment files for both:
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

import {
  desktopEnvPairs,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — untyped .mjs module shared with release scripts
} from "./lib/desktop-environment.mjs";

const ROOT = path.resolve(__dirname, "..");
const WEB_DIR = path.join(ROOT, "apps", "web");
const ROOT_ENV_OUT = path.join(ROOT, ".env.local");
const WEB_ENV_OUT = path.join(WEB_DIR, ".env.local");
const SUPABASE_ENV_OUT = path.join(WEB_DIR, ".env");

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

function normalizeOptionalSentryDsn(value: string | undefined): string {
  const dsn = value?.trim() ?? "";
  if (!dsn || dsn.includes("...")) {
    return "";
  }

  try {
    const url = new URL(dsn);
    const projectPath = url.pathname.replace(/\/+$/, "");
    if (!["http:", "https:"].includes(url.protocol) || !url.username || !url.host || !projectPath) {
      return "";
    }
    return dsn;
  } catch {
    return "";
  }
}

const optionalSentryDsn = z.string().optional().default("").transform(normalizeOptionalSentryDsn);

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
    dsn: optionalSentryDsn,
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
    oauth_credentials_file: z.string().optional().default(""),
    oauth_client_id: z.string().optional().default(""),
    oauth_client_secret: z.string().optional().default(""),
  }),
  google_auth: z
    .object({
      enabled_dev: z.boolean().default(false),
      enabled_prod: z.boolean().default(false),
      credentials_file: z.string().optional().default(""),
      client_id: z.string().optional().default(""),
      client_secret: z.string().optional().default(""),
    })
    .optional()
    .default({
      enabled_dev: false,
      enabled_prod: false,
      credentials_file: "",
      client_id: "",
      client_secret: "",
    }),
  aws: z.object({
    region: z.string().min(1),
    access_key_id: z.string().min(1),
    secret_access_key: z.string().min(1),
  }),
  // Consumed by the release scripts (publish-apt-repo.mjs), not by any .env file.
  apt: z
    .object({
      signing_key_id: z.string().optional().default(""),
      signing_passphrase: z.string().optional().default(""),
    })
    .optional()
    .default({ signing_key_id: "", signing_passphrase: "" }),
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
type VercelEnvironment = "development" | "preview" | "production";

const googleOAuthClientSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
});

const googleOAuthDownloadSchema = z
  .object({
    web: googleOAuthClientSchema.optional(),
    installed: googleOAuthClientSchema.optional(),
  })
  .refine((value) => value.web || value.installed, {
    message: 'expected a "web" or "installed" OAuth client',
  });

const isVercelBuild = process.env.VERCEL === "1";
const isProductionPush = process.argv.includes("--production");
const skipOnVercel = process.argv.includes("--skip-on-vercel");
const isDryRun = process.argv.includes("--dry-run");

const SENSITIVE_VERCEL_VARIABLES = new Set([
  "SUPABASE_SECRET_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "SENTRY_AUTH_TOKEN",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "OPENAI_API_KEY",
  "LOCAL_LLM_API_KEY",
  "TOKEN_ENCRYPTION_KEY",
  "OAUTH_STATE_SECRET",
]);

function resolveVercelEnvironment(): VercelEnvironment | null {
  if (isProductionPush) return "production";

  const flag = process.argv.find((arg) => arg.startsWith("--vercel="));
  if (!flag) return null;

  const value = flag.slice("--vercel=".length);
  if (value === "development" || value === "preview" || value === "production") {
    return value;
  }

  console.error(
    `Invalid --vercel=${value}. Expected "development", "preview", or "production".`,
  );
  process.exit(1);
}

const vercelEnvironment = resolveVercelEnvironment();

function resolveMode(): Mode {
  if (vercelEnvironment === "production" || process.argv.includes("--prod")) return "prod";
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

const googleOAuthFileCache = new Map<string, z.infer<typeof googleOAuthClientSchema>>();

function loadGoogleOAuthFile(
  configuredPath: string,
  configKey: string,
): z.infer<typeof googleOAuthClientSchema> {
  if (path.isAbsolute(configuredPath)) {
    console.error(`.credentials ${configKey} must be a path relative to the repository root.`);
    process.exit(1);
  }

  const resolvedPath = path.resolve(ROOT, configuredPath);
  const relativePath = path.relative(ROOT, resolvedPath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    console.error(`.credentials ${configKey} must stay within the repository root.`);
    process.exit(1);
  }

  const cached = googleOAuthFileCache.get(resolvedPath);
  if (cached) return cached;

  if (!fs.existsSync(resolvedPath)) {
    console.error(`Missing Google OAuth credentials file: ${relativePath}`);
    process.exit(1);
  }

  try {
    const parsed = googleOAuthDownloadSchema.parse(
      JSON.parse(fs.readFileSync(resolvedPath, "utf8")),
    );
    const client = parsed.web ?? parsed.installed;
    if (!client) throw new Error('expected a "web" or "installed" OAuth client');
    googleOAuthFileCache.set(resolvedPath, client);
    return client;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Invalid Google OAuth credentials file ${relativePath}: ${message}`);
    process.exit(1);
  }
}

function hydrateGoogleOAuthFiles(credentials: Credentials): Credentials {
  if (credentials.google.oauth_credentials_file) {
    const client = loadGoogleOAuthFile(
      credentials.google.oauth_credentials_file,
      "google.oauth_credentials_file",
    );
    credentials.google.oauth_client_id = client.client_id;
    credentials.google.oauth_client_secret = client.client_secret;
  }

  if (credentials.google_auth.credentials_file) {
    const client = loadGoogleOAuthFile(
      credentials.google_auth.credentials_file,
      "google_auth.credentials_file",
    );
    credentials.google_auth.client_id = client.client_id;
    credentials.google_auth.client_secret = client.client_secret;
  }

  return credentials;
}

function loadCredentials(): Credentials | null {
  if (skipOnVercel && isVercelBuild && !firstExisting(CREDENTIALS_CANDIDATES)) {
    console.log("Vercel build detected; using Vercel environment variables.");
    return null;
  }

  let source = firstExisting(CREDENTIALS_CANDIDATES);
  if (!source) {
    if (isVercelBuild || vercelEnvironment || process.env.CI === "true") {
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
  const credentials = hydrateGoogleOAuthFiles(result.data);
  if (
    credentials.google_auth.enabled_dev &&
    (!credentials.google_auth.client_id || !credentials.google_auth.client_secret)
  ) {
    console.error(
      ".credentials google_auth.client_id and client_secret are required when enabled_dev is true.",
    );
    process.exit(1);
  }
  return credentials;
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
    [
      "NEXT_PUBLIC_GOOGLE_AUTH_ENABLED",
      String(mode === "dev" ? c.google_auth.enabled_dev : c.google_auth.enabled_prod),
    ],

    ["NEXT_PUBLIC_SUPABASE_URL", supabase.url],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", supabase.publishable_key],
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

function toSupabaseEnvPairs(c: Credentials): Array<[string, string]> {
  // The provider remains configured in config.toml so the checked-in config is stable.
  // Dummy values keep ordinary local development working when Google Auth is disabled;
  // the client UI is independently hidden by NEXT_PUBLIC_GOOGLE_AUTH_ENABLED.
  return [
    [
      "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID",
      c.google_auth.enabled_dev ? c.google_auth.client_id : "google-auth-disabled",
    ],
    [
      "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET",
      c.google_auth.enabled_dev ? c.google_auth.client_secret : "google-auth-disabled",
    ],
  ];
}

function writeEnvFile(filePath: string, pairs: Array<[string, string]>, mode: Mode) {
  const header = [
    "# GENERATED by scripts/sync-env.ts - do not edit by hand.",
    "# Source of truth is .credentials and its configured OAuth JSON files.",
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

type VercelEnvMetadata = {
  key: string;
  configurationId: string | null;
};

function listVercelEnvironment(environment: VercelEnvironment): Map<string, VercelEnvMetadata> {
  const res = spawnSync("vercel", ["env", "list", environment, "--format", "json"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  });
  if (res.status !== 0) {
    console.error(`failed to list Vercel ${environment} environment variables.`);
    process.exit(res.status ?? 1);
  }

  try {
    const data = JSON.parse(res.stdout) as { envs?: VercelEnvMetadata[] };
    if (!Array.isArray(data.envs)) {
      throw new Error("response is missing envs array");
    }
    return new Map(data.envs.map((env) => [env.key, env]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`failed to parse Vercel environment metadata: ${message}`);
    process.exit(1);
  }
}

function pushToVercel(
  pairs: Array<[string, string]>,
  environment: VercelEnvironment,
) {
  const existing = isDryRun ? new Map<string, VercelEnvMetadata>() : listVercelEnvironment(environment);
  let pushed = 0;
  let skipped = 0;
  let integrationManaged = 0;

  for (const [name, value] of pairs) {
    if (value === "") {
      console.log(`  - skipping empty ${name}`);
      skipped += 1;
      continue;
    }

    const remote = existing.get(name);
    if (remote?.configurationId) {
      console.log(`  - preserving integration-managed ${name}`);
      integrationManaged += 1;
      continue;
    }

    const action = remote ? "update" : "add";
    const args = ["env", action, name, environment, "--yes"];
    if (SENSITIVE_VERCEL_VARIABLES.has(name)) {
      args.push("--sensitive");
    }

    if (isDryRun) {
      console.log(`  - would sync ${name} to Vercel ${environment}`);
      pushed += 1;
      continue;
    }

    console.log(`  - syncing ${name} to Vercel ${environment}`);
    const res = spawnSync("vercel", args, {
      cwd: ROOT,
      input: value + "\n",
      stdio: ["pipe", "inherit", "inherit"],
      encoding: "utf8",
    });
    if (res.status !== 0) {
      console.error(`failed to sync ${name} to Vercel ${environment}.`);
      process.exit(res.status ?? 1);
    }
    pushed += 1;
  }

  const verb = isDryRun ? "would sync" : "synced";
  console.log(
    `${verb} ${pushed} web env vars to Vercel ${environment}; ` +
      `preserved ${integrationManaged} integration-managed and skipped ${skipped} empty.`,
  );
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
  if (vercelEnvironment) {
    pushToVercel(webPairs, vercelEnvironment);
    return;
  }

  writeEnvFile(WEB_ENV_OUT, webPairs, mode);
  writeEnvFile(ROOT_ENV_OUT, desktopEnvPairs(creds, mode), mode);
  writeEnvFile(SUPABASE_ENV_OUT, toSupabaseEnvPairs(creds), mode);
}

main();
