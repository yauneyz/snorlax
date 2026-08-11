"use client";
import posthog from "posthog-js";
import { config } from "@/lib/config";
import type { AnalyticsEventName, AnalyticsPlatform } from "@/lib/analytics/events";

export function getPosthog() {
  if (!config.posthog.key) return null;
  return posthog;
}

type TrackEventOptions = {
  beacon?: boolean;
  accessToken?: string | null;
  source?: "web" | "desktop";
  deviceId?: string | null;
  occurredAt?: string;
  appVersion?: string | null;
  platform?: AnalyticsPlatform | null;
  idempotencyKey?: string | null;
};

/**
 * Sends the authoritative event to the first-party ingest route. The server fans web events
 * out to PostHog after the database write, avoiding duplicate client/server captures.
 */
export function trackEvent(
  event: AnalyticsEventName,
  properties?: Record<string, unknown>,
  options: TrackEventOptions = {},
): Promise<void> {
  const payload = JSON.stringify({
    event,
    source: options.source ?? "web",
    device_id: options.deviceId,
    occurred_at: options.occurredAt,
    app_version: options.appVersion,
    platform: options.platform,
    idempotency_key: options.idempotencyKey,
    props: properties ?? {},
  });
  const endpoint = new URL("/api/analytics/track", window.location.origin);
  for (const key of ["utm_source", "utm_medium", "utm_campaign"] as const) {
    const value = new URLSearchParams(window.location.search).get(key);
    if (value) endpoint.searchParams.set(key, value);
  }

  if (options.beacon && !options.accessToken && navigator.sendBeacon) {
    navigator.sendBeacon(endpoint, new Blob([payload], { type: "application/json" }));
    return Promise.resolve();
  }

  return fetch(endpoint, {
    method: "POST",
    credentials: "same-origin",
    keepalive: options.beacon,
    headers: {
      "content-type": "application/json",
      ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}),
    },
    body: payload,
  })
    .then(() => undefined)
    .catch(() => undefined);
}
