/**
 * The single server-side analytics seam (analytics-arch.md §9.1).
 *
 * Everything that records an analytics signal calls `track()` or `reportUsage()` here, and
 * nothing else writes to the `analytics_*` tables. The Supabase write is authoritative;
 * PostHog is a best-effort fan-out that never blocks and never throws.
 *
 * **Nothing in this module ever throws.** Analytics must not be able to break a user flow:
 * every path is wrapped, failures go to Sentry, and the caller gets `void`. Callers should
 * still `void track(...)` rather than awaiting on a latency-sensitive path.
 *
 * Lives under `src/server/` rather than `src/lib/analytics/` because it holds the
 * service-role client, and `apps/web/eslint.config.mjs` allowlists exactly
 * `src/app/api/**`, `src/server/**` and a few named files for that import.
 */
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { config } from "@/lib/config";
import { captureException } from "@/lib/sentry";
import { getPosthogServer } from "@/lib/analytics/posthog-server";
import {
  ONCE_PER_PERSON_EVENTS,
  USER_FACING_ERROR_EVENTS,
  isPosthogFanoutEvent,
  type AnalyticsEventName,
  type AnalyticsPlatform,
  type AnalyticsSource,
} from "@/lib/analytics/events";
import { sendInsightsPush } from "@/server/insights/push";

/** Caps app_error pushes at one per device+event in this window during a crash loop. Every
 * occurrence still lands in analytics_events — this only throttles the notification. */
const ERROR_PUSH_THROTTLE_MS = 15 * 60_000;

/** Channel context for a request. Written to the person once, and onto each event row. */
export type Attribution = {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  referrer_host?: string | null;
  landing_path?: string | null;
  country?: string | null;
};

export type TrackInput = {
  event: AnalyticsEventName;
  source: AnalyticsSource;
  /** Server-derived from the `tal_aid` cookie. Never accepted from a request body. */
  anonId?: string | null;
  /** Client-asserted. Authorizes nothing. */
  deviceId?: string | null;
  /** Derived from a verified session or bearer token. Never accepted from a request body. */
  userId?: string | null;
  occurredAt?: Date | string | null;
  appVersion?: string | null;
  platform?: AnalyticsPlatform | null;
  attribution?: Attribution;
  props?: Record<string, unknown>;
  /**
   * Explicit de-duplication key. When omitted, once-per-person events get one derived
   * automatically (see `deriveIdempotencyKey`).
   */
  idempotencyKey?: string | null;
};

export type UsageRow = {
  device_id: string;
  local_date: string;
  tz_offset_minutes: number;
  platform: string;
  app_version?: string | null;
  app_opens?: number;
  focus_enabled_count?: number;
  focus_disabled_count?: number;
  focus_seconds?: number;
  longest_focus_seconds?: number;
  scheduled_focus_seconds?: number;
  sessions_completed?: number;
  sessions_aborted?: number;
  key_present_seconds?: number;
  extension_connected?: boolean;
  first_activity_at?: string | null;
  last_activity_at?: string | null;
};

export type UsageReport = {
  deviceId: string;
  userId?: string | null;
  rows: UsageRow[];
};

/**
 * How far `occurred_at` may sit from `received_at`, by source.
 *
 * §7 specifies a flat ±24h, which contradicts §6.5 and §9.3: the desktop keeps a 35-day
 * offline queue precisely so a machine that is offline for weeks still reports accurately,
 * and a 24h clamp would destroy the timestamps that buffer exists to preserve. Web and
 * server events have no such buffer, so they keep the tight window.
 */
const CLOCK_SKEW_MS: Record<AnalyticsSource, { past: number; future: number }> = {
  web: { past: 24 * 3600_000, future: 3600_000 },
  server: { past: 24 * 3600_000, future: 3600_000 },
  desktop: { past: 35 * 24 * 3600_000, future: 3600_000 },
};

/** Clamps a client-supplied timestamp into a plausible window around now. */
export function clampOccurredAt(
  occurredAt: Date | string | null | undefined,
  source: AnalyticsSource,
  now: Date = new Date(),
): string {
  const nowMs = now.getTime();
  if (!occurredAt) return now.toISOString();
  const parsed = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  const ms = parsed.getTime();
  if (Number.isNaN(ms)) return now.toISOString();

  const { past, future } = CLOCK_SKEW_MS[source];
  if (ms < nowMs - past) return new Date(nowMs - past).toISOString();
  if (ms > nowMs + future) return new Date(nowMs + future).toISOString();
  return parsed.toISOString();
}

/**
 * Turns "once per person, ever" into a database guarantee via the unique index on
 * `idempotency_key`, so a call site firing twice is harmless.
 *
 * This is what makes it safe for `account_created` to be emitted from both the signup form
 * (the password flow is entirely client-side — `SignupForm.tsx` calls `auth.signUp`) and
 * the OAuth callback route. §10 of the design doc attributes both to the callback, which is
 * only true for the Google flow.
 */
export function deriveIdempotencyKey(input: TrackInput): string | null {
  if (input.idempotencyKey) return input.idempotencyKey;
  if (!ONCE_PER_PERSON_EVENTS.has(input.event)) return null;
  // Prefer the most durable identifier available for the scope of "once".
  const scope = input.userId ?? input.deviceId ?? input.anonId;
  return scope ? `${input.event}:${scope}` : null;
}

/**
 * Whether writes are allowed at all.
 *
 * `pnpm web:prod` is `sync:env --mode=prod && next dev` — a dev server pointed at the
 * PRODUCTION database. Without this guard, browsing localhost in that mode writes your own
 * page views, signups and download clicks into the production funnel the dashboard exists
 * to report, and there is no way to tell them apart afterwards.
 *
 * So: a non-production build may only write to a local database. `pnpm web:dev` writes to
 * local postgres (which is what the bot suite depends on), `pnpm web:prod` becomes
 * read-only, and a real Vercel deployment is unaffected.
 */
export function ingestAllowed(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  supabaseUrl: string = config.supabase.url,
): boolean {
  if (nodeEnv === "production") return true;
  try {
    const host = new URL(supabaseUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

let warnedAboutSkip = false;
function noteSkip() {
  if (warnedAboutSkip) return;
  warnedAboutSkip = true;
  console.debug(
    "[analytics] ingest disabled: a non-production build may only write to a local database. " +
      "This is expected under `pnpm web:prod`, which reads production data but must not write to it.",
  );
}

/** Prefixed identifiers for the identity graph — one text PK covers all three spaces. */
function identifiersFor(input: {
  anonId?: string | null;
  deviceId?: string | null;
  userId?: string | null;
}): string[] {
  const ids: string[] = [];
  if (input.anonId) ids.push(`anon:${input.anonId}`);
  if (input.deviceId) ids.push(`device:${input.deviceId}`);
  if (input.userId) ids.push(`user:${input.userId}`);
  return ids;
}

function attributionPayload(a: Attribution | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!a) return out;
  for (const key of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "referrer_host",
    "landing_path",
    "country",
  ] as const) {
    const value = a[key];
    if (value) out[key] = value;
  }
  return out;
}

/**
 * Records one milestone event. Fire-and-forget: resolves even when the database is down.
 */
export async function track(input: TrackInput): Promise<void> {
  try {
    if (!ingestAllowed()) {
      noteSkip();
      return;
    }

    const db = supabaseAdmin();
    const identifiers = identifiersFor(input);

    // Resolve/merge the person first. Events store raw identifiers, so this is only about
    // keeping the graph current and recording attribution — the event row does not carry a
    // person_id and never needs backfilling after a merge.
    if (identifiers.length > 0) {
      const { error } = await db.rpc("analytics_link", {
        p_identifiers: identifiers,
        p_attribution: attributionPayload(input.attribution),
      });
      if (error) throw new Error(`analytics_link failed: ${error.message}`);
    }

    const occurredAt = clampOccurredAt(input.occurredAt, input.source);
    const idempotencyKey = deriveIdempotencyKey(input);

    const { error } = await db.from("analytics_events").insert({
      event: input.event,
      occurred_at: occurredAt,
      anon_id: input.anonId ?? null,
      device_id: input.deviceId ?? null,
      user_id: input.userId ?? null,
      source: input.source,
      app_version: input.appVersion ?? null,
      platform: input.platform ?? null,
      utm_source: input.attribution?.utm_source ?? null,
      utm_medium: input.attribution?.utm_medium ?? null,
      utm_campaign: input.attribution?.utm_campaign ?? null,
      referrer_host: input.attribution?.referrer_host ?? null,
      country: input.attribution?.country ?? null,
      props: input.props ?? {},
      idempotency_key: idempotencyKey,
    });

    // 23505 is the unique violation on idempotency_key: a replayed desktop flush, or a
    // once-per-person event firing from its second call site. Both are successes.
    if (error && error.code !== "23505") {
      throw new Error(`analytics_events insert failed: ${error.message}`);
    }

    fanoutToPosthog(input);

    if (USER_FACING_ERROR_EVENTS.has(input.event)) {
      await alertOnUserFacingError(db, input);
    }
  } catch (err) {
    await captureException(err, { scope: "analytics.track", event: input.event });
  }
}

/**
 * Real-time push for any error a user hit (analytics-arch.md's install-health panel already
 * aggregates `service_install_failed` by reason; this covers every USER_FACING_ERROR_EVENTS
 * member with a live alert instead of a dashboard count). Throttled per device+*message*, not
 * just device+event — "identical errors" means the same failure repeating (a crash loop),
 * which a plain event-name key would over-throttle: every distinct main_process_error, for
 * instance, would otherwise share one budget. Every occurrence still lands in
 * `analytics_events` regardless of whether this particular one pushes.
 */
async function alertOnUserFacingError(
  db: ReturnType<typeof supabaseAdmin>,
  input: TrackInput,
): Promise<void> {
  try {
    const message = typeof input.props?.message === "string" ? input.props.message : input.event;

    if (input.deviceId) {
      const since = new Date(Date.now() - ERROR_PUSH_THROTTLE_MS).toISOString();
      const { count, error } = await db
        .from("analytics_events")
        .select("id", { count: "exact", head: true })
        .eq("event", input.event)
        .eq("device_id", input.deviceId)
        .eq("props->>message", message)
        .gte("received_at", since);
      if (error) throw new Error(`throttle check failed: ${error.message}`);
      if ((count ?? 0) > 1) return;
    }

    void sendInsightsPush({ type: "app_error", platform: input.platform, message });
  } catch (err) {
    await captureException(err, { scope: "analytics.alertOnUserFacingError", event: input.event });
  }
}

/** Best-effort only. A PostHog outage must be invisible to the caller and to Supabase. */
function fanoutToPosthog(input: TrackInput): void {
  try {
    if (!isPosthogFanoutEvent(input.source)) return;
    const posthog = getPosthogServer();
    if (!posthog) return;
    const distinctId = input.userId ?? input.anonId ?? input.deviceId;
    if (!distinctId) return;
    posthog.capture({
      distinctId,
      event: input.event,
      properties: { ...input.props, ...attributionPayload(input.attribution) },
    });
  } catch {
    // Deliberately silent: this is the non-authoritative store.
  }
}

/**
 * Upserts tier-2 daily usage rows. Counters are cumulative for the day, so the underlying
 * RPC uses `greatest()` and a replayed or out-of-order batch is a no-op.
 */
export async function reportUsage(input: UsageReport): Promise<void> {
  try {
    if (!ingestAllowed()) {
      noteSkip();
      return;
    }
    if (input.rows.length === 0) return;

    const db = supabaseAdmin();
    const identifiers = identifiersFor({ deviceId: input.deviceId, userId: input.userId });
    if (identifiers.length > 0) {
      const { error } = await db.rpc("analytics_link", { p_identifiers: identifiers });
      if (error) throw new Error(`analytics_link failed: ${error.message}`);
    }

    // The device owns `device_id`; `user_id` comes from the verified bearer token, so it is
    // stamped here rather than trusted from the row.
    const rows = input.rows.map((row) => ({ ...row, user_id: input.userId ?? null }));

    const { error } = await db.rpc("analytics_report_usage", { p_rows: rows });
    if (error) throw new Error(`analytics_report_usage failed: ${error.message}`);
  } catch (err) {
    await captureException(err, { scope: "analytics.reportUsage", deviceId: input.deviceId });
  }
}
