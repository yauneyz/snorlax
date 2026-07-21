/**
 * Public, build-time desktop configuration derived from the credentials source of truth.
 * Keep this list shared by env sync and release builds so packaged apps cannot silently
 * lose their Supabase/API configuration.
 */
export function desktopEnvPairs(credentials, mode) {
  if (mode !== "dev" && mode !== "prod") {
    throw new Error(`Unsupported desktop environment mode: ${mode}`);
  }

  const stripe = credentials.stripe;
  const stripePublishableKey =
    stripe.mode === "live"
      ? stripe.publishable_key_live
      : stripe.publishable_key_test;
  const supabase = credentials.supabase[mode];
  const appUrl = mode === "prod" ? credentials.app.url_prod : credentials.app.url_dev;

  return [
    ["APP_ENV", mode === "prod" ? "production" : "development"],
    ["TALYSMAN_PIPE", mode === "prod" ? "talysman" : "talysman-dev"],
    [
      "GOOGLE_AUTH_ENABLED",
      String(
        mode === "prod"
          ? credentials.google_auth?.enabled_prod ?? false
          : credentials.google_auth?.enabled_dev ?? false,
      ),
    ],
    ["VITE_SUPABASE_URL", supabase.url],
    ["VITE_SUPABASE_ANON_KEY", supabase.publishable_key],
    ["VITE_STRIPE_PUBLISHABLE_KEY", stripePublishableKey ?? ""],
    ["VITE_PAYMENT_URL", appUrl],
    ["API_BASE_URL", appUrl],
    [
      "UPDATE_FEED_URL",
      `${credentials.extension_hosting.public_s3_base_url.replace(/\/+$/, "")}/desktop`,
    ],
  ];
}

export const REQUIRED_PRODUCTION_DESKTOP_ENV = [
  "API_BASE_URL",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "UPDATE_FEED_URL",
];

/**
 * Bearer credentials are stripped when fetch follows a redirect to another origin.
 * Verify that production builds point directly at the deployed desktop API instead
 * of an apex/www (or other cross-origin) redirect.
 */
export async function verifyDirectDesktopApiBaseUrl(apiBaseUrl, fetchImpl = fetch) {
  let endpoint;
  try {
    endpoint = new URL("/api/desktop/entitlement", apiBaseUrl);
  } catch {
    throw new Error(`API_BASE_URL is not a valid URL: ${apiBaseUrl}`);
  }

  if (endpoint.protocol !== "https:") {
    throw new Error(`Production API_BASE_URL must use HTTPS: ${apiBaseUrl}`);
  }

  let response;
  try {
    response = await fetchImpl(endpoint, { method: "GET", redirect: "manual" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not reach desktop API at ${endpoint.origin}: ${message}`, {
      cause: error,
    });
  }

  if (response.status >= 300 && response.status < 400) {
    const destination = response.headers.get("location") ?? "another URL";
    throw new Error(
      `API_BASE_URL redirects to ${destination}. Configure the final API origin directly; ` +
        "cross-origin redirects strip desktop bearer tokens.",
    );
  }

  if (response.status !== 401) {
    throw new Error(
      `Desktop API probe returned ${response.status}; expected 401 from the unauthenticated entitlement endpoint.`,
    );
  }
}
