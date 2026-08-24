import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  analyticsEventName,
  analyticsPlatform,
  analyticsSource,
  parseEventProps,
  type AnalyticsEventName,
} from "@/lib/analytics/events";
import type { Attribution, UsageRow } from "@/server/analytics/track";

export const TRACK_BODY_LIMIT = 8 * 1024;
export const USAGE_BODY_LIMIT = 32 * 1024;
export const MAX_USAGE_ROWS = 40;

const uuid = z.string().uuid();
const nullablePlatform = analyticsPlatform.optional().nullable();

const trackBodySchema = z
  .object({
    event: analyticsEventName,
    source: analyticsSource.refine((source) => source !== "server", {
      message: "server events cannot be submitted through the public endpoint",
    }),
    device_id: uuid.optional().nullable(),
    occurred_at: z.string().datetime({ offset: true }).optional().nullable(),
    app_version: z.string().max(64).optional().nullable(),
    platform: nullablePlatform,
    props: z.record(z.unknown()).optional(),
    idempotency_key: z.string().min(1).max(256).optional().nullable(),
  })
  .strict();

const smallCounter = z.number().int().min(0).max(32_767).optional();
const seconds = z.number().int().min(0).max(86_400).optional();
const usageRowSchema = z
  .object({
    device_id: uuid.optional(),
    local_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    tz_offset_minutes: z.number().int().min(-840).max(840),
    platform: analyticsPlatform,
    app_version: z.string().max(64).optional().nullable(),
    app_opens: smallCounter,
    focus_enabled_count: smallCounter,
    focus_disabled_count: smallCounter,
    focus_seconds: seconds,
    longest_focus_seconds: seconds,
    scheduled_focus_seconds: seconds,
    sessions_completed: smallCounter,
    sessions_aborted: smallCounter,
    key_present_seconds: seconds,
    extension_connected: z.boolean().optional(),
    first_activity_at: z.string().datetime({ offset: true }).optional().nullable(),
    last_activity_at: z.string().datetime({ offset: true }).optional().nullable(),
  })
  .strict();

const usageBodySchema = z
  .object({
    device_id: uuid,
    rows: z.array(usageRowSchema).min(1).max(MAX_USAGE_ROWS),
  })
  .strict();

export type ParsedTrackBody = {
  event: AnalyticsEventName;
  source: "web" | "desktop";
  deviceId?: string | null;
  occurredAt?: string | null;
  appVersion?: string | null;
  platform?: "win" | "mac" | "linux" | null;
  props: Record<string, unknown>;
  idempotencyKey?: string | null;
};

export type BodyReadResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; message: string };

/** Reads a request incrementally so a missing Content-Length cannot bypass the cap. */
export async function readJsonBody(request: NextRequest, limit: number): Promise<BodyReadResult> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    return { ok: false, status: 413, message: `body may not exceed ${limit} bytes` };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400, message: "JSON body required" };
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel();
      return { ok: false, status: 413, message: `body may not exceed ${limit} bytes` };
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, message: "invalid JSON" };
  }
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}

export function parseTrackBody(
  value: unknown,
): { ok: true; data: ParsedTrackBody } | { ok: false; message: string } {
  const parsed = trackBodySchema.safeParse(value);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  const props = parseEventProps(parsed.data.event, parsed.data.props);
  if (!props.ok) return props;
  return {
    ok: true,
    data: {
      event: parsed.data.event,
      source: parsed.data.source as "web" | "desktop",
      deviceId: parsed.data.device_id,
      occurredAt: parsed.data.occurred_at,
      appVersion: parsed.data.app_version,
      platform: parsed.data.platform,
      props: props.props,
      idempotencyKey: parsed.data.idempotency_key,
    },
  };
}

function dateWithinDays(value: string, now: Date, days: number): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return false;
  return Math.abs(date.getTime() - now.getTime()) <= days * 24 * 60 * 60 * 1000;
}

export function parseUsageBody(
  value: unknown,
  now: Date = new Date(),
): { ok: true; deviceId: string; rows: UsageRow[] } | { ok: false; message: string } {
  const parsed = usageBodySchema.safeParse(value);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };

  for (const [index, row] of parsed.data.rows.entries()) {
    if (row.device_id && row.device_id !== parsed.data.device_id) {
      return { ok: false, message: `rows.${index}.device_id must match device_id` };
    }
    if (!dateWithinDays(row.local_date, now, 40)) {
      return { ok: false, message: `rows.${index}.local_date must be within 40 days of today` };
    }
  }

  return {
    ok: true,
    deviceId: parsed.data.device_id,
    rows: parsed.data.rows.map((row) => ({ ...row, device_id: parsed.data.device_id })),
  };
}

function bounded(value: string | null, max: number): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function hostOf(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).hostname || undefined;
  } catch {
    return undefined;
  }
}

function withoutWww(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

/**
 * The referrer host that earned the visit, or undefined when we only know it was us.
 *
 * The client's `document.referrer` (sent as a prop on `page_viewed`) is the authoritative
 * one: the `Referer` header on a beacon POST is the page that fired the beacon, which is
 * always our own site. Same for the download route, where the header is our `/download`
 * page. Recording either would file the person under `talysman.app` forever, since
 * first-touch attribution is immutable -- so a self-referral is dropped and the person
 * stays open for a real channel (or lands in `direct`).
 */
function referrerHostFor(request: NextRequest, props: Record<string, unknown>): string | undefined {
  const host =
    hostOf(typeof props.referrer_host === "string" ? `https://${props.referrer_host}` : null) ??
    hostOf(request.headers.get("referer"));
  if (!host) return undefined;
  return withoutWww(host) === withoutWww(request.nextUrl.hostname) ? undefined : host;
}

export function attributionFromRequest(
  request: NextRequest,
  props: Record<string, unknown>,
): Attribution {
  const referrerHost = referrerHostFor(request, props);
  const path = typeof props.path === "string" ? props.path : undefined;
  const clickChannel = request.nextUrl.searchParams.has("gclid")
    ? { source: "google", medium: "cpc" }
    : request.nextUrl.searchParams.has("msclkid")
      ? { source: "bing", medium: "cpc" }
      : request.nextUrl.searchParams.has("fbclid")
        ? { source: "meta", medium: "paid_social" }
        : request.nextUrl.searchParams.has("ttclid")
          ? { source: "tiktok", medium: "paid_social" }
          : undefined;
  return {
    // Preserve explicit UTMs, but do not file paid clicks as direct merely because an ad
    // platform supplied its click id without a full UTM set.
    utm_source:
      bounded(request.nextUrl.searchParams.get("utm_source"), 128) ?? clickChannel?.source,
    utm_medium:
      bounded(request.nextUrl.searchParams.get("utm_medium"), 128) ?? clickChannel?.medium,
    utm_campaign: bounded(request.nextUrl.searchParams.get("utm_campaign"), 256),
    referrer_host: bounded(referrerHost ?? null, 253),
    landing_path: bounded(path ?? null, 2048),
    country: bounded(request.headers.get("x-vercel-ip-country"), 8),
  };
}

export function classifyUserAgent(value: string | null): "bot" | "human" {
  if (!value) return "human";
  return /bot|crawler|spider|headlesschrome|slurp|bingpreview|facebookexternalhit/i.test(value)
    ? "bot"
    : "human";
}

/** Privacy-safe visitor dimensions. We retain these labels, never the raw user-agent. */
export function visitorDimensions(
  userAgent: string | null,
  clientHintMobile: string | null = null,
  clientHintPlatform: string | null = null,
): { device_type: string; os: string } {
  const ua = userAgent?.toLowerCase() ?? "";
  const hintedPlatform = clientHintPlatform?.replaceAll('"', "").toLowerCase() ?? "";
  const tablet = /ipad|tablet|kindle|silk/.test(ua) || (/android/.test(ua) && !/mobile/.test(ua));
  const mobile = clientHintMobile === "?1" || /iphone|ipod|mobile|windows phone/.test(ua);

  let os = ua ? "Other" : "Unknown";
  if (/windows phone/.test(ua)) os = "Windows Phone";
  else if (/android/.test(hintedPlatform) || /android/.test(ua)) os = "Android";
  else if (/ios|ipados/.test(hintedPlatform) || /ipad|iphone|ipod/.test(ua)) os = "iOS / iPadOS";
  else if (/chrome os/.test(hintedPlatform) || /cros/.test(ua)) os = "Chrome OS";
  else if (/windows/.test(hintedPlatform) || /windows/.test(ua)) os = "Windows";
  else if (/macos/.test(hintedPlatform) || /macintosh|mac os x/.test(ua)) os = "macOS";
  else if (/linux/.test(hintedPlatform) || /linux/.test(ua)) os = "Linux";

  return {
    device_type: tablet ? "Tablet" : mobile ? "Mobile" : ua ? "Desktop" : "Unknown",
    os,
  };
}

type Bucket = { startedAt: number; count: number };
const buckets = new Map<string, Bucket>();
const RATE_WINDOW_MS = 60_000;

function take(key: string, limit: number, now: number): boolean {
  const current = buckets.get(key);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    buckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

export function requestIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** Generous abuse control; authoritative validation and DB grants remain the hard boundary. */
export function rateLimitAnalytics(
  request: NextRequest,
  deviceId?: string | null,
  now: number = Date.now(),
): boolean {
  if (!take(`ip:${requestIp(request)}`, 240, now)) return false;
  if (deviceId && !take(`device:${deviceId}`, 120, now)) return false;
  if (buckets.size > 10_000) {
    for (const [key, bucket] of buckets) {
      if (now - bucket.startedAt >= RATE_WINDOW_MS) buckets.delete(key);
    }
  }
  return true;
}

export function resetAnalyticsRateLimitsForTests(): void {
  buckets.clear();
}
