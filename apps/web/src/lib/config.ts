/**
 * Typed, validated runtime config. Every module imports from here — never
 * from `process.env` — so a missing var fails at module-load rather than at
 * request time.
 *
 * Public (`NEXT_PUBLIC_*`) vars are readable from client code. Everything
 * else is only safe to import from server modules.
 */
import { z } from "zod";
import { normalizeSentryDsn } from "./sentry/config";

function normalizeSupabaseUrl(value: string): string {
  const url = new URL(value);
  const servicePath = /\/(?:rest|auth|storage|functions|realtime)\/v\d+\/?$/;
  url.pathname = url.pathname.replace(servicePath, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

const supabaseProjectUrl = z.string().url().transform(normalizeSupabaseUrl);

/** A value containing `...` is a placeholder copied from `.credentials.example`. */
const optionalStripped = z
  .string()
  .optional()
  .default("")
  .transform((value) => {
    const trimmed = value.trim();
    return trimmed.includes("...") ? "" : trimmed;
  });

const optionalPosthogKey = optionalStripped.refine(
  (value) => value === "" || /^phc_[A-Za-z0-9_-]+$/.test(value),
  'must be a PostHog project token beginning with "phc_" or empty',
);

/** Like `supabaseProjectUrl` but tolerates absence — an unconfigured target is not an error. */
const optionalSupabaseProjectUrl = optionalStripped.transform((value, ctx) => {
  if (value === "") return "";
  if (!z.string().url().safeParse(value).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be a URL or empty" });
    return z.NEVER;
  }
  return normalizeSupabaseUrl(value);
});

const optionalSentryDsn = z.string().optional().default("").transform(normalizeSentryDsn);
const booleanEnv = z
  .enum(["true", "false"])
  .optional()
  .default("false")
  .transform((value) => value === "true");

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_APP_NAME: z.string().min(1),
  NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: booleanEnv,
  NEXT_PUBLIC_SUPABASE_URL: supabaseProjectUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SENTRY_DSN: optionalSentryDsn,
  NEXT_PUBLIC_POSTHOG_KEY: optionalPosthogKey,
  NEXT_PUBLIC_POSTHOG_HOST: z.string().optional().default("https://us.i.posthog.com"),
  NEXT_PUBLIC_GA4_MEASUREMENT_ID: z.string().optional().default(""),
});

const serverSchemaBase = publicSchema.extend({
  APP_ENVIRONMENT: z.enum(["development", "production"]).default("development"),
  SUPABASE_SECRET_KEY: z.string().min(1),
  SUPABASE_PROJECT_REF: z.string().optional().default(""),
  STRIPE_MODE: z.enum(["test", "live"]).default("test"),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_MONTHLY: z.string().min(1),
  STRIPE_PRICE_YEARLY: z.string().min(1),
  STRIPE_PORTAL_CONFIG_ID: z.string().optional().default(""),
  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM: z.string().min(1),
  SENTRY_ORG: z.string().optional().default(""),
  SENTRY_PROJECT: z.string().optional().default(""),
  SENTRY_AUTH_TOKEN: z.string().optional().default(""),
  GOOGLE_SITE_VERIFICATION: z.string().optional().default(""),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional().default(""),
  EXTENSION_ARTIFACTS_BUCKET: z.string().min(1),
  EXTENSION_ARTIFACTS_REGION: z.string().min(1).default("us-east-1"),
  EXTENSION_PUBLIC_S3_BASE_URL: z.string().url(),
  EXTENSION_CHROME_STORE_URL: z.union([z.string().url(), z.literal("")]).optional().default(""),
  EXTENSION_EDGE_STORE_URL: z.union([z.string().url(), z.literal("")]).optional().default(""),
  EXTENSION_FIREFOX_STORE_URL: z.union([z.string().url(), z.literal("")]).optional().default(""),
  LLM_PROVIDER: z.enum(["openai", "local"]).default("openai"),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_DEFAULT_MODEL: z.string().min(1).default("gpt-5.1"),
  OPENAI_ORGANIZATION: z.string().optional().default(""),
  OPENAI_BASE_URL: z.string().optional().default(""),
  LOCAL_LLM_ENDPOINT: z.string().url().default("http://127.0.0.1:11434/v1/chat/completions"),
  LOCAL_LLM_MODEL: z.string().min(1).default("qwen3.5-9b"),
  LOCAL_LLM_API_KEY: z.string().optional().default(""),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[A-Za-z0-9+/=]{43,}$/, "must be base64 of ≥32 bytes"),
  OAUTH_STATE_SECRET: z.string().min(32),

  // Insights dashboard (analytics-arch.md §12). All five are optional and default to empty
  // because `scripts/sync-env.ts` writes them only into the local `.env.local` and never to
  // Vercel — a required field here would fail `next build` for every deployment. Both target
  // credential sets are written regardless of `--mode`, so /insights (prod) and /insights/dev
  // (local postgres) both work from one locally-running server.
  ANALYTICS_DASHBOARD: z.enum(["0", "1"]).optional().default("0"),
  ANALYTICS_PROD_SUPABASE_URL: optionalSupabaseProjectUrl,
  ANALYTICS_PROD_SUPABASE_SECRET_KEY: optionalStripped,
  ANALYTICS_DEV_SUPABASE_URL: optionalSupabaseProjectUrl,
  ANALYTICS_DEV_SUPABASE_SECRET_KEY: optionalStripped,

  // Bearer token for GET /api/analytics/summary (the mobile widget feed). Unlike the dashboard
  // above, this route is meant to work in every deployed environment, so it needs its own
  // credential set pushed to Vercel rather than reusing the local-only ANALYTICS_PROD_* pair.
  INSIGHTS_WIDGET_API_KEY: optionalStripped,
  // Firebase Cloud Messaging service-account credentials. All three are optional so local
  // development and preview deployments can run without push; sends become a no-op until the
  // production environment is configured.
  FCM_PROJECT_ID: optionalStripped,
  FCM_CLIENT_EMAIL: optionalStripped,
  FCM_PRIVATE_KEY: optionalStripped,
  // Where /insights (the `prod` target) fetches from instead of querying Supabase directly —
  // the same deployed endpoint the Android widget uses. www, not the apex: the apex 308s to
  // www and a fetch that follows that redirect drops the Authorization header cross-host.
  INSIGHTS_API_BASE_URL: z.string().url().optional().default("https://www.talysman.app"),
});

/** "test" | "live" for a prefixed Stripe key; null for placeholders we shouldn't judge. */
function stripeKeyMode(key: string): "test" | "live" | null {
  if (/^(?:pk|sk|rk)_live_/.test(key)) return "live";
  if (/^(?:pk|sk|rk)_test_/.test(key)) return "test";
  return null;
}

const serverSchema = serverSchemaBase.superRefine((value, ctx) => {
  if (
    value.APP_ENVIRONMENT === "development" &&
    value.LLM_PROVIDER === "openai" &&
    value.OPENAI_API_KEY.length === 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OPENAI_API_KEY"],
      message: "OPENAI_API_KEY is required when development Smart filtering uses OpenAI.",
    });
  }

  // Backstop for keys edited straight into the hosting dashboard rather than synced from
  // .credentials: a deployment that says "live" but holds test keys takes no real money.
  for (const key of ["STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"] as const) {
    const keyMode = stripeKeyMode(value[key]);
    if (keyMode && keyMode !== value.STRIPE_MODE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `is a ${keyMode}-mode key but STRIPE_MODE is "${value.STRIPE_MODE}".`,
      });
    }
  }
});

// Next.js inlines `process.env.NEXT_PUBLIC_*` at build time — they must be
// referenced by their literal names, not computed keys.
const publicEnv = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  NEXT_PUBLIC_GA4_MEASUREMENT_ID: process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID,
};

function parsePublic() {
  const r = publicSchema.safeParse(publicEnv);
  if (!r.success) {
    throw new Error(
      "Invalid public env config:\n" +
        r.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n"),
    );
  }
  return r.data;
}

function parseServer() {
  const serverEnv = {
    ...publicEnv,
    ...process.env,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const r = serverSchema.safeParse(serverEnv);
  if (!r.success) {
    throw new Error(
      "Invalid server env config:\n" +
        r.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n"),
    );
  }
  return r.data;
}

const isServer = typeof window === "undefined";

const parsed = isServer ? parseServer() : parsePublic();
const serverParsed = isServer ? (parsed as z.infer<typeof serverSchema>) : null;

function resolveOpenAIEndpoint(baseUrl: string): string {
  if (!baseUrl) {
    return "https://api.openai.com/v1/chat/completions";
  }

  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

const llmProvider = (serverParsed?.LLM_PROVIDER ?? "openai") as "openai" | "local";
const openAIEndpoint = resolveOpenAIEndpoint(serverParsed?.OPENAI_BASE_URL ?? "");
const llmEndpoint =
  llmProvider === "local" ? (serverParsed?.LOCAL_LLM_ENDPOINT ?? "") : openAIEndpoint;
const llmModel =
  llmProvider === "local"
    ? (serverParsed?.LOCAL_LLM_MODEL ?? "")
    : (serverParsed?.OPENAI_DEFAULT_MODEL ?? "");
const llmApiKey =
  llmProvider === "local"
    ? (serverParsed?.LOCAL_LLM_API_KEY ?? "")
    : (serverParsed?.OPENAI_API_KEY ?? "");

export const config = {
  app: {
    url: parsed.NEXT_PUBLIC_APP_URL,
    name: parsed.NEXT_PUBLIC_APP_NAME,
    environment: (isServer
      ? (parsed as z.infer<typeof serverSchema>).APP_ENVIRONMENT
      : "development") as "development" | "production",
  },
  supabase: {
    url: parsed.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    secretKey: isServer ? (parsed as z.infer<typeof serverSchema>).SUPABASE_SECRET_KEY : "",
    projectRef: isServer ? (parsed as z.infer<typeof serverSchema>).SUPABASE_PROJECT_REF : "",
  },
  stripe: {
    mode: (isServer ? (parsed as z.infer<typeof serverSchema>).STRIPE_MODE : "test") as
      | "test"
      | "live",
    publishableKey: parsed.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    secretKey: isServer ? (parsed as z.infer<typeof serverSchema>).STRIPE_SECRET_KEY : "",
    webhookSecret: isServer ? (parsed as z.infer<typeof serverSchema>).STRIPE_WEBHOOK_SECRET : "",
    priceMonthly: isServer ? (parsed as z.infer<typeof serverSchema>).STRIPE_PRICE_MONTHLY : "",
    priceYearly: isServer ? (parsed as z.infer<typeof serverSchema>).STRIPE_PRICE_YEARLY : "",
    portalConfigId: isServer
      ? (parsed as z.infer<typeof serverSchema>).STRIPE_PORTAL_CONFIG_ID
      : "",
  },
  resend: {
    apiKey: isServer ? (parsed as z.infer<typeof serverSchema>).RESEND_API_KEY : "",
    from: isServer ? (parsed as z.infer<typeof serverSchema>).RESEND_FROM : "",
  },
  sentry: {
    dsn: parsed.NEXT_PUBLIC_SENTRY_DSN,
    org: isServer ? (parsed as z.infer<typeof serverSchema>).SENTRY_ORG : "",
    project: isServer ? (parsed as z.infer<typeof serverSchema>).SENTRY_PROJECT : "",
    authToken: isServer ? (parsed as z.infer<typeof serverSchema>).SENTRY_AUTH_TOKEN : "",
  },
  posthog: {
    key: parsed.NEXT_PUBLIC_POSTHOG_KEY,
    host: parsed.NEXT_PUBLIC_POSTHOG_HOST,
  },
  google: {
    authEnabled: parsed.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED,
    ga4MeasurementId: parsed.NEXT_PUBLIC_GA4_MEASUREMENT_ID,
    siteVerification: isServer
      ? (parsed as z.infer<typeof serverSchema>).GOOGLE_SITE_VERIFICATION
      : "",
    oauthClientId: isServer ? (parsed as z.infer<typeof serverSchema>).GOOGLE_OAUTH_CLIENT_ID : "",
    oauthClientSecret: isServer
      ? (parsed as z.infer<typeof serverSchema>).GOOGLE_OAUTH_CLIENT_SECRET
      : "",
  },
  extensionHosting: {
    bucket: isServer ? (parsed as z.infer<typeof serverSchema>).EXTENSION_ARTIFACTS_BUCKET : "",
    region: isServer ? (parsed as z.infer<typeof serverSchema>).EXTENSION_ARTIFACTS_REGION : "",
    publicS3BaseUrl: isServer
      ? (parsed as z.infer<typeof serverSchema>).EXTENSION_PUBLIC_S3_BASE_URL
      : "",
  },
  extensionStores: {
    chromeUrl: isServer
      ? (parsed as z.infer<typeof serverSchema>).EXTENSION_CHROME_STORE_URL
      : "",
    edgeUrl: isServer ? (parsed as z.infer<typeof serverSchema>).EXTENSION_EDGE_STORE_URL : "",
    firefoxUrl: isServer
      ? (parsed as z.infer<typeof serverSchema>).EXTENSION_FIREFOX_STORE_URL
      : "",
  },
  openai: {
    apiKey: isServer ? (parsed as z.infer<typeof serverSchema>).OPENAI_API_KEY : "",
    defaultModel: isServer ? (parsed as z.infer<typeof serverSchema>).OPENAI_DEFAULT_MODEL : "",
    organization: isServer ? (parsed as z.infer<typeof serverSchema>).OPENAI_ORGANIZATION : "",
    baseUrl: isServer ? (parsed as z.infer<typeof serverSchema>).OPENAI_BASE_URL : "",
  },
  localLlm: {
    endpoint: isServer ? (parsed as z.infer<typeof serverSchema>).LOCAL_LLM_ENDPOINT : "",
    model: isServer ? (parsed as z.infer<typeof serverSchema>).LOCAL_LLM_MODEL : "",
    apiKey: isServer ? (parsed as z.infer<typeof serverSchema>).LOCAL_LLM_API_KEY : "",
  },
  llm: {
    provider: llmProvider,
    endpoint: isServer ? llmEndpoint : "",
    model: isServer ? llmModel : "",
    apiKey: isServer ? llmApiKey : "",
  },
  security: {
    tokenEncryptionKey: isServer
      ? (parsed as z.infer<typeof serverSchema>).TOKEN_ENCRYPTION_KEY
      : "",
    oauthStateSecret: isServer
      ? (parsed as z.infer<typeof serverSchema>).OAUTH_STATE_SECRET
      : "",
  },
  /**
   * The two analytics read targets. Deliberately separate from `config.supabase`, which
   * follows whichever mode the server was started in: the dashboards must show the same two
   * datasets under `pnpm web:dev` and `pnpm web:prod` alike.
   */
  insights: {
    enabled: isServer ? (parsed as z.infer<typeof serverSchema>).ANALYTICS_DASHBOARD === "1" : false,
    prod: {
      url: isServer ? (parsed as z.infer<typeof serverSchema>).ANALYTICS_PROD_SUPABASE_URL : "",
      secretKey: isServer
        ? (parsed as z.infer<typeof serverSchema>).ANALYTICS_PROD_SUPABASE_SECRET_KEY
        : "",
    },
    dev: {
      url: isServer ? (parsed as z.infer<typeof serverSchema>).ANALYTICS_DEV_SUPABASE_URL : "",
      secretKey: isServer
        ? (parsed as z.infer<typeof serverSchema>).ANALYTICS_DEV_SUPABASE_SECRET_KEY
        : "",
    },
    widgetApiKey: isServer
      ? (parsed as z.infer<typeof serverSchema>).INSIGHTS_WIDGET_API_KEY
      : "",
    apiBaseUrl: isServer
      ? (parsed as z.infer<typeof serverSchema>).INSIGHTS_API_BASE_URL
      : "https://www.talysman.app",
    fcm: {
      projectId: isServer ? (parsed as z.infer<typeof serverSchema>).FCM_PROJECT_ID : "",
      clientEmail: isServer ? (parsed as z.infer<typeof serverSchema>).FCM_CLIENT_EMAIL : "",
      privateKey: isServer
        ? (parsed as z.infer<typeof serverSchema>).FCM_PRIVATE_KEY.replace(/\\n/g, "\n")
        : "",
    },
  },
} as const;

export type AppConfig = typeof config;

// Re-export raw schemas for tests.
export { publicSchema, serverSchema };
