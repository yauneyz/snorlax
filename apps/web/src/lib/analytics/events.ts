/**
 * The analytics event taxonomy (analytics-arch.md §5.2).
 *
 * Tier 1 — milestones. Things that happen roughly once per person, ever, and are worth a
 * row each with full attribution. Naming is `snake_case`, `object_verb_past`.
 *
 * This module is deliberately PURE — no `server-only`, no imports from the seam. The zod
 * enum is the ingest allowlist (§14: reject unknown names with a 400, which doubles as a
 * typo catcher), and unit tests plus the bot E2E suite both import it directly.
 */
import { z } from "zod";

export const ANALYTICS_EVENT_NAMES = [
  // --- Marketing / web -----------------------------------------------------
  "page_viewed",
  "signup_started",
  "account_created",
  "signed_in",
  "download_clicked",

  // --- Desktop -------------------------------------------------------------
  "app_installed",
  "service_install_started",
  "service_installed",
  "service_install_failed",
  "onboarding_step_viewed",
  "onboarding_completed",
  "onboarding_skipped",
  "extension_connected",
  "usb_key_paired",
  "usb_pair_failed",
  "schedule_created",
  "focus_session_completed",
  "app_uninstalled",
  "bootstrap_failed",
  "window_load_failed",
  "main_process_error",
  "renderer_error",
  "service_disconnected",
  "ipc_handler_error",

  // --- Billing (all server-side, from the Stripe webhook) ------------------
  "checkout_started",
  "trial_started",
  "subscription_started",
  "subscription_renewed",
  "payment_failed",
  "subscription_canceled",
  "subscription_ended",
  "refund_issued",
  "comp_code_redeemed",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

export const analyticsEventName = z.enum(ANALYTICS_EVENT_NAMES);

/** Where the event was emitted from. `server` covers webhooks and redirect routes. */
export const analyticsSource = z.enum(["web", "desktop", "server"]);
export type AnalyticsSource = z.infer<typeof analyticsSource>;

export const analyticsPlatform = z.enum(["win", "mac", "linux"]);
export type AnalyticsPlatform = z.infer<typeof analyticsPlatform>;

/**
 * Per-event prop schemas. Absent from this map means "no required props".
 *
 * `session_index` is typed as an int on purpose: `analytics_funnel` casts it in SQL, and a
 * single uncastable value from the public ingest endpoint would make that view raise for
 * every query. The view carries a regex guard too — this is the other half of that belt.
 */
export const ANALYTICS_EVENT_PROPS = {
  page_viewed: z.object({
    path: z.string().max(2048),
    title: z.string().max(512).optional(),
    referrer_host: z.string().max(253).optional(),
  }),
  signup_started: z.object({
    method: z.enum(["password", "google"]),
    surface: z.enum(["web", "desktop"]),
  }),
  download_clicked: z.object({
    platform: analyticsPlatform,
    app_version: z.string().max(64).optional(),
  }),
  service_install_failed: z.object({
    platform: analyticsPlatform,
    reason: z.string().max(256),
  }),
  usb_pair_failed: z.object({ reason: z.string().max(256) }),
  bootstrap_failed: z.object({
    message: z.string().max(2000),
    stack: z.string().max(4000).optional(),
  }),
  window_load_failed: z.object({
    message: z.string().max(2000),
    stack: z.string().max(4000).optional(),
  }),
  main_process_error: z.object({
    message: z.string().max(2000),
    stack: z.string().max(4000).optional(),
    fatal: z.boolean().optional(),
  }),
  renderer_error: z.object({
    message: z.string().max(2000),
    stack: z.string().max(4000).optional(),
  }),
  service_disconnected: z.object({ message: z.string().max(2000) }),
  ipc_handler_error: z.object({
    channel: z.string().max(128),
    message: z.string().max(2000),
  }),
  onboarding_step_viewed: z.object({ step: z.number().int().min(0).max(64) }),
  focus_session_completed: z.object({
    duration_s: z.number().int().min(0).max(86_400),
    source: z.enum(["user", "schedule", "boot"]),
    ended_by: z.enum(["completed", "key", "recovery", "shutdown"]),
    // Capped at the first 3 per device; beyond that, tier 2 rollups carry the signal.
    session_index: z.number().int().min(1).max(3),
  }),
  app_uninstalled: z.object({ days_installed: z.number().int().min(0).optional() }),
  payment_failed: z.object({ attempt: z.number().int().min(0).optional() }),
} as const satisfies Partial<Record<AnalyticsEventName, z.ZodTypeAny>>;

/** §14 caps `props` so a junk-filled fact table cannot grow through the public endpoint. */
export const MAX_PROPS_KEYS = 30;

export const analyticsProps = z
  .record(z.unknown())
  .refine((v) => Object.keys(v).length <= MAX_PROPS_KEYS, {
    message: `props may not exceed ${MAX_PROPS_KEYS} keys`,
  });

/**
 * Validates props for a given event, when that event declares a schema. Unknown keys are
 * preserved rather than stripped — extra context is harmless and occasionally useful, and
 * the key cap is what actually bounds the column.
 */
export function parseEventProps(
  event: AnalyticsEventName,
  props: Record<string, unknown> | undefined,
): { ok: true; props: Record<string, unknown> } | { ok: false; message: string } {
  const raw = props ?? {};
  const capped = analyticsProps.safeParse(raw);
  if (!capped.success) return { ok: false, message: capped.error.issues[0].message };

  const schema = (ANALYTICS_EVENT_PROPS as Record<string, z.ZodTypeAny | undefined>)[event];
  if (!schema) return { ok: true, props: raw };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: `props.${issue.path.join(".")}: ${issue.message}` };
  }
  // Merge so declared props are validated/coerced while undeclared extras survive.
  return { ok: true, props: { ...raw, ...(parsed.data as Record<string, unknown>) } };
}

/**
 * Events that must never occur more than once per person. `track()` derives an
 * `idempotency_key` for these so the database enforces it, rather than every call site
 * having to. This is what makes it safe for `account_created` to fire from both the signup
 * form (password flow) and the OAuth callback — see the note in §10 of analytics-arch.md,
 * which wrongly assumes the callback sees both.
 */
export const ONCE_PER_PERSON_EVENTS = new Set<AnalyticsEventName>([
  "account_created",
  "app_installed",
  "onboarding_completed",
  "trial_started",
  "subscription_started",
]);

/**
 * Every event that represents a real error a user hit — install-blocking or not. Drives both
 * the real-time push alert (server/analytics/track.ts, throttled per device+message so a
 * crash loop can't spam the phone) and the full-text errors feed
 * (server/analytics/queries/errors.ts, GET /api/analytics/errors) — one source of truth so
 * the two never drift.
 */
export const USER_FACING_ERROR_EVENTS = new Set<AnalyticsEventName>([
  "bootstrap_failed",
  "service_install_failed",
  "window_load_failed",
  "main_process_error",
  "renderer_error",
  "service_disconnected",
  "ipc_handler_error",
]);

/**
 * Tier-1 web events also go to PostHog; desktop and billing stay in Supabase only.
 * Per §3: PostHog earns its keep on session replay and ad-hoc funnels for the marketing
 * site. Rollups are not events, and per-event pricing punishes usage data.
 */
export function isPosthogFanoutEvent(source: AnalyticsSource): boolean {
  return source === "web";
}
