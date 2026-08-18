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
import {
  liveStripeCredentialIssues,
  stripeModeForTarget,
  stripeReleaseFailure,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — untyped .mjs module shared with release scripts
} from "./lib/stripe-mode.mjs";

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
  // No `mode` here on purpose: which key set gets exported is derived from the push
  // target (see stripeMode above), so it cannot drift out of sync with the deployment.
  stripe: z.object({
    publishable_key_test: z.string().min(1),
    secret_key_test: z.string().min(1),
    webhook_secret_test: z.string().min(1),
    publishable_key_live: z.string().min(1).optional().or(z.literal("")),
    secret_key_live: z.string().min(1).optional().or(z.literal("")),
    webhook_secret_live: z.string().min(1).optional().or(z.literal("")),
    price_id_monthly_test: z.string().min(1),
    price_id_yearly_test: z.string().min(1),
    price_id_monthly_live: z.string().optional().default(""),
    price_id_yearly_live: z.string().optional().default(""),
    portal_configuration_id: z.string().optional().default(""),
  }),
  resend: z.object({
    api_key: z.string().min(1),
    from: z.string().min(1),
    // Test-only destination for `pnpm web:test:email`; never read by the app itself.
    email_test_address: z.union([z.string().email(), z.literal("")]).optional().default(""),
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
      model: z.string().min(1).default("qwen3.5-9b"),
      api_key: z.string().optional().default(""),
    })
    .optional()
    .default({
      endpoint: "http://127.0.0.1:11434/v1/chat/completions",
      model: "qwen3.5-9b",
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
  insights: z
    .object({
      widget_api_key: z.string().optional().default(""),
      fcm_service_account_file: z.string().optional().default(""),
      fcm_project_id: z.string().optional().default(""),
      fcm_client_email: z.string().optional().default(""),
      fcm_private_key: z.string().optional().default(""),
    })
    .optional()
    .default({
      widget_api_key: "",
      fcm_service_account_file: "",
      fcm_project_id: "",
      fcm_client_email: "",
      fcm_private_key: "",
    }),
});

type Credentials = z.infer<typeof credentialsSchema>;
type Mode = "dev" | "prod";
type StripeMode = "test" | "live";
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

const fcmServiceAccountSchema = z.object({
  type: z.literal("service_account"),
  project_id: z.string().min(1),
  client_email: z.string().email(),
  private_key: z.string().min(1),
});

const isVercelBuild = process.env.VERCEL === "1";
const isProductionPush = process.argv.includes("--production");
const skipOnVercel = process.argv.includes("--skip-on-vercel");
const isDryRun = process.argv.includes("--dry-run");

/**
 * `--dummy` is a local-development escape hatch for a machine that does not have the real
 * secrets: every credential this script cannot read degrades to an obvious placeholder and
 * a warning instead of exiting. It is deliberately refused anywhere the missing value would
 * reach a deployment, so the default run keeps catching genuine configuration mistakes.
 * `scripts/dev.mjs --dummy` sets the environment variable for the nested pnpm invocation.
 */
const dummyRequested =
  process.argv.includes("--dummy") || process.env.TALYSMAN_DUMMY_CREDENTIALS === "true";

const DUMMY_GOOGLE_OAUTH_CLIENT = {
  client_id: "dummy-google-oauth-client-id",
  client_secret: "dummy-google-oauth-client-secret",
};

function warnDummy(message: string) {
  console.warn(`[dummy] ${message}`);
}

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
  "ANALYTICS_PROD_SUPABASE_SECRET_KEY",
  "INSIGHTS_WIDGET_API_KEY",
  "FCM_CLIENT_EMAIL",
  "FCM_PRIVATE_KEY",
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

const isDeploymentSync = isVercelBuild || vercelEnvironment !== null || process.env.CI === "true";
if (dummyRequested && isDeploymentSync) {
  console.error(
    "--dummy is a local-development escape hatch and cannot be used for a CI or Vercel sync.",
  );
  process.exit(1);
}
const allowDummyCredentials = dummyRequested;

/**
 * Stripe mode follows the push target, not the dev/prod mode: only the Vercel production
 * environment charges real cards. Preview runs on production Supabase but must stay on
 * test Stripe, and so must the .env.local files this script writes for local runs —
 * `pnpm web:prod` is prod infrastructure on a laptop, not a customer-facing deployment.
 */
const stripeTarget = vercelEnvironment ?? "development";
const stripeMode: StripeMode = stripeModeForTarget(stripeTarget);

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

  // A missing or unreadable client file is the one failure `--dummy` exists for: the JSON is
  // gitignored, so a checkout on a second machine has nothing to read.
  const unusable = (reason: string): z.infer<typeof googleOAuthClientSchema> => {
    if (!allowDummyCredentials) {
      console.error(reason);
      process.exit(1);
    }
    warnDummy(`${reason} — using placeholder Google OAuth credentials.`);
    googleOAuthFileCache.set(resolvedPath, DUMMY_GOOGLE_OAUTH_CLIENT);
    return DUMMY_GOOGLE_OAUTH_CLIENT;
  };

  if (!fs.existsSync(resolvedPath)) {
    return unusable(`Missing Google OAuth credentials file: ${relativePath}`);
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
    return unusable(`Invalid Google OAuth credentials file ${relativePath}: ${message}`);
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

  if (credentials.insights.fcm_service_account_file) {
    const configuredPath = credentials.insights.fcm_service_account_file;
    if (path.isAbsolute(configuredPath)) {
      console.error(".credentials insights.fcm_service_account_file must be relative to the repository root.");
      process.exit(1);
    }
    const resolvedPath = path.resolve(ROOT, configuredPath);
    const relativePath = path.relative(ROOT, resolvedPath);
    if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
      console.error(".credentials insights.fcm_service_account_file must stay within the repository root.");
      process.exit(1);
    }
    try {
      const account = fcmServiceAccountSchema.parse(JSON.parse(fs.readFileSync(resolvedPath, "utf8")));
      credentials.insights.fcm_project_id = account.project_id;
      credentials.insights.fcm_client_email = account.client_email;
      credentials.insights.fcm_private_key = account.private_key;
    } catch (error) {
      if (!allowDummyCredentials) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Invalid FCM service account ${relativePath}: ${message}`);
        process.exit(1);
      }
      warnDummy(`FCM service account ${relativePath} is unavailable — push notifications are disabled.`);
    }
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

  let result = credentialsSchema.safeParse(toml.parse(fs.readFileSync(source, "utf8")));
  if (!result.success && allowDummyCredentials) {
    // An incomplete .credentials is still a credentials failure; fall back to the tracked
    // example rather than inventing a value for every field the schema wants.
    const example = EXAMPLE_CANDIDATES.includes(source) ? null : firstExisting(EXAMPLE_CANDIDATES);
    if (example) {
      warnDummy(
        `${path.relative(ROOT, source)} failed validation; syncing from ${path.relative(ROOT, example)} instead.`,
      );
      source = example;
      result = credentialsSchema.safeParse(toml.parse(fs.readFileSync(source, "utf8")));
    }
  }
  if (!result.success) {
    console.error(`${path.relative(ROOT, source)} failed validation:`);
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
    if (!allowDummyCredentials) {
      console.error(
        ".credentials google_auth.client_id and client_secret are required when enabled_dev is true.",
      );
      process.exit(1);
    }
    warnDummy(
      "google_auth is enabled for dev without a client id/secret — using placeholders; Google sign-in will not work.",
    );
    credentials.google_auth.client_id ||= DUMMY_GOOGLE_OAUTH_CLIENT.client_id;
    credentials.google_auth.client_secret ||= DUMMY_GOOGLE_OAUTH_CLIENT.client_secret;
  }
  return credentials;
}

function stripeValues(c: Credentials, stripeMode: StripeMode) {
  const live = stripeMode === "live";
  return {
    publishableKey: live ? c.stripe.publishable_key_live : c.stripe.publishable_key_test,
    secretKey: live ? c.stripe.secret_key_live : c.stripe.secret_key_test,
    webhookSecret: live ? c.stripe.webhook_secret_live : c.stripe.webhook_secret_test,
    priceMonthly: live ? c.stripe.price_id_monthly_live : c.stripe.price_id_monthly_test,
    priceYearly: live ? c.stripe.price_id_yearly_live : c.stripe.price_id_yearly_test,
  };
}

function toWebEnvPairs(c: Credentials, mode: Mode): Array<[string, string]> {
  const stripe = stripeValues(c, stripeMode);
  const supabase = c.supabase[mode];
  const appUrl = mode === "prod" ? c.app.url_prod : c.app.url_dev;
  const appEnvironment = mode === "prod" ? "production" : "development";
  // Smart filtering is a development-only feature for now. Keep development on the local model;
  // production receives the value for schema compatibility, but never exposes or calls the LLM.
  const llmProvider = "local";

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

    ["STRIPE_MODE", stripeMode],
    ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", stripe.publishableKey ?? ""],
    ["STRIPE_SECRET_KEY", stripe.secretKey ?? ""],
    ["STRIPE_WEBHOOK_SECRET", stripe.webhookSecret ?? ""],
    ["STRIPE_PRICE_MONTHLY", stripe.priceMonthly ?? ""],
    ["STRIPE_PRICE_YEARLY", stripe.priceYearly ?? ""],
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

  // The production web deployment is the one target that charges real cards, so it is the
  // one that has to have a complete live configuration.
  if (stripeMode === "live") {
    const failure = stripeReleaseFailure(liveStripeCredentialIssues(creds.stripe), {
      surface: "the production web deployment",
    });
    if (failure) {
      console.error(failure);
      process.exit(1);
    }
  }

  const webPairs = toWebEnvPairs(creds, mode);
  if (vercelEnvironment) {
    // Production alone gets the analytics widget feed (analytics-arch.md §12.4): the prod
    // Supabase target plus the bearer token that gates GET /api/analytics/summary. Preview and
    // development deployments still get neither, so /insights-style DB access stays off every
    // deployment except this one deliberate, read-only, token-gated exception.
    const pairs: Array<[string, string]> =
      vercelEnvironment === "production"
        ? [
            ...webPairs,
            ["ANALYTICS_PROD_SUPABASE_URL", creds.supabase.prod.url],
            ["ANALYTICS_PROD_SUPABASE_SECRET_KEY", creds.supabase.prod.secret_key],
            ["INSIGHTS_WIDGET_API_KEY", creds.insights.widget_api_key],
            ["FCM_PROJECT_ID", creds.insights.fcm_project_id],
            ["FCM_CLIENT_EMAIL", creds.insights.fcm_client_email],
            ["FCM_PRIVATE_KEY", creds.insights.fcm_private_key],
          ]
        : webPairs;
    pushToVercel(pairs, vercelEnvironment);
    return;
  }

  // The webhook integration test (tests/integration/stripe-webhook-cli.test.ts) drives the
  // real Stripe CLI against test mode and looks for STRIPE_CLI_API_KEY. It is always the
  // test-mode secret key regardless of `mode`, and stays local-only (never pushed to Vercel).
  // RESEND_TEST_ADDRESS is local-only for the same reason: it is the inbox
  // `pnpm web:test:email` delivers to, and no deployed code path reads it.
  // The insights dashboards (analytics-arch.md §12) read BOTH Supabase targets, always, so
  // /insights (production) and /insights/dev (local postgres) both work from one locally
  // running server no matter which `--mode` it was started with. These are local-only by
  // construction rather than by policy: `pushToVercel` iterates `webPairs` and returns above,
  // so nothing appended here can ever reach a deployment — except the production carve-out
  // above, which pushes ANALYTICS_PROD_* and INSIGHTS_WIDGET_API_KEY explicitly, by name.
  const localWebPairs: Array<[string, string]> = [
    ...webPairs,
    ["STRIPE_CLI_API_KEY", creds.stripe.secret_key_test],
    ["RESEND_TEST_ADDRESS", creds.resend.email_test_address],
    ["ANALYTICS_DASHBOARD", "1"],
    ["ANALYTICS_PROD_SUPABASE_URL", creds.supabase.prod.url],
    ["ANALYTICS_PROD_SUPABASE_SECRET_KEY", creds.supabase.prod.secret_key],
    ["ANALYTICS_DEV_SUPABASE_URL", creds.supabase.dev.url],
    ["ANALYTICS_DEV_SUPABASE_SECRET_KEY", creds.supabase.dev.secret_key],
    ["INSIGHTS_WIDGET_API_KEY", creds.insights.widget_api_key],
    ["FCM_PROJECT_ID", creds.insights.fcm_project_id],
    ["FCM_CLIENT_EMAIL", creds.insights.fcm_client_email],
    ["FCM_PRIVATE_KEY", creds.insights.fcm_private_key],
  ];

  writeEnvFile(WEB_ENV_OUT, localWebPairs, mode);
  writeEnvFile(ROOT_ENV_OUT, desktopEnvPairs(creds, mode), mode);
  writeEnvFile(SUPABASE_ENV_OUT, toSupabaseEnvPairs(creds), mode);
}

main();
