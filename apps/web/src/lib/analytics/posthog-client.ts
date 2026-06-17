"use client";
import posthog from "posthog-js";
import { config } from "@/lib/config";

export function getPosthog() {
  if (!config.posthog.key) return null;
  return posthog;
}

export function trackEvent(event: string, properties?: Record<string, unknown>) {
  if (!config.posthog.key) return;
  posthog.capture(event, properties);
}
