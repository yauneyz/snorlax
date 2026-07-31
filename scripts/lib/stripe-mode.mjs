/**
 * Stripe mode is derived from where an artifact is going — it is never configured by hand.
 * Only the surfaces that real customers reach charge real cards:
 *
 *   development  test   local dev, `web:prod` against prod infra, the desktop .env.local,
 *                       and `release:local` (a NixOS-only install that never publishes)
 *   preview      test   Vercel preview deployments
 *   production   live   the Vercel production deployment, and published desktop installers
 *
 * The functions below are the single source of that mapping, plus the guardrails that stop
 * a production artifact from being built or published with an incomplete live configuration.
 */

/** Escape hatch for publishing before the live Stripe configuration is complete. */
export const ALLOW_TEST_STRIPE_ENV = "ALLOW_TEST_STRIPE_RELEASE";

export const STRIPE_TARGETS = ["development", "preview", "production"];

/**
 * The only place "which Stripe mode?" is answered.
 *
 * @param {string} target
 * @returns {"test" | "live"}
 */
export function stripeModeForTarget(target) {
  if (target === "production") return "live";
  if (target === "development" || target === "preview") return "test";
  throw new Error(
    `Unknown Stripe target "${target}" (expected ${STRIPE_TARGETS.join(" | ")})`,
  );
}

/** Live-mode `.credentials` [stripe] fields, with the prefix each value must carry. */
const LIVE_CREDENTIAL_FIELDS = /** @type {const} */ ([
  ["publishable_key_live", /^pk_live_/, "pk_live_"],
  ["secret_key_live", /^(?:sk|rk)_live_/, "sk_live_ or rk_live_"],
  ["webhook_secret_live", /^whsec_/, "whsec_"],
  ["price_id_monthly_live", /^price_/, "price_"],
  ["price_id_yearly_live", /^price_/, "price_"],
]);

/**
 * "test" | "live" for any Stripe key that carries a recognizable prefix, else null for
 * placeholders and unfamiliar shapes (never guess — a null just skips the cross-check).
 */
export function stripeKeyMode(key) {
  const value = (key ?? "").trim();
  if (/^(?:pk|sk|rk)_live_/.test(value)) return "live";
  if (/^(?:pk|sk|rk)_test_/.test(value)) return "test";
  return null;
}

/**
 * Problems that make a `.credentials` [stripe] block unfit for a production target: a live
 * field that is empty, or one holding something other than a live value.
 */
export function liveStripeCredentialIssues(stripe = {}) {
  const issues = [];
  for (const [field, pattern, expected] of LIVE_CREDENTIAL_FIELDS) {
    const value = (stripe[field] ?? "").trim();
    if (!value) {
      issues.push(`stripe.${field} is empty — fill it with the live-mode value`);
    } else if (!pattern.test(value)) {
      issues.push(`stripe.${field} is not a live value (expected it to start with ${expected})`);
    }
  }
  return issues;
}

/**
 * Problems with the Stripe configuration a desktop build is about to bake in. This checks
 * the effective build environment rather than `.credentials`, because that is what actually
 * ends up in the artifact — including on hosts that build from committed .env files alone.
 */
export function desktopStripeReleaseIssues(environment = process.env) {
  const issues = [];
  const mode = (environment.STRIPE_MODE ?? "").trim();
  const publishableKey = (environment.VITE_STRIPE_PUBLISHABLE_KEY ?? "").trim();

  if (!mode) {
    issues.push("STRIPE_MODE is unset — run `pnpm sync:env --mode=prod` to regenerate it");
  } else if (mode !== "live") {
    issues.push(`STRIPE_MODE resolved to "${mode}" — a published installer must be "live"`);
  }

  if (!publishableKey) {
    issues.push(
      "VITE_STRIPE_PUBLISHABLE_KEY is empty — set stripe.publishable_key_live in .credentials",
    );
  } else if (stripeKeyMode(publishableKey) !== "live") {
    issues.push("VITE_STRIPE_PUBLISHABLE_KEY is not a live key (expected it to start with pk_live_)");
  }

  return issues;
}

function formatIssues(issues, surface) {
  return [
    `Refusing to ship an incomplete Stripe configuration: ${surface} runs in live mode, but:`,
    ...issues.map((issue) => `  - ${issue}`),
    "",
    "Stripe mode is derived from the target, so there is no switch to flip — fill the *_live",
    "values in the [stripe] block of .credentials and re-sync (`pnpm sync:env --mode=prod`",
    "for desktop builds, `pnpm sync:env:prod` for the web app). To publish anyway with the",
    `live configuration still incomplete, set ${ALLOW_TEST_STRIPE_ENV}=true.`,
  ].join("\n");
}

/**
 * Returns a failure message when `issues` should block the release, or null when there is
 * nothing to block on — including the deliberate override, which only warns.
 *
 * @param {string[]} issues
 * @param {{
 *   surface: string,
 *   environment?: Record<string, string | undefined>,
 *   warn?: (message: string) => void,
 * }} options
 * @returns {string | null}
 */
export function stripeReleaseFailure(
  issues,
  { surface, environment = process.env, warn = console.warn },
) {
  if (issues.length === 0) return null;
  if (environment[ALLOW_TEST_STRIPE_ENV] === "true") {
    warn(
      [
        `\nWARNING ${ALLOW_TEST_STRIPE_ENV}=true — shipping ${surface}`,
        "        with an incomplete live Stripe configuration:",
        ...issues.map((issue) => `          - ${issue}`),
        "        Real customers cannot pay through this release.\n",
      ].join("\n"),
    );
    return null;
  }
  return formatIssues(issues, surface);
}

/**
 * `stripeReleaseFailure`, as a throw — for callers that already fail on exceptions.
 *
 * @param {string[]} issues
 * @param {Parameters<typeof stripeReleaseFailure>[1]} options
 */
export function assertLiveStripeRelease(issues, options) {
  const failure = stripeReleaseFailure(issues, options);
  if (failure) throw new Error(failure);
}
