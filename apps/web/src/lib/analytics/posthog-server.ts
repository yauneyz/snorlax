import "server-only";
import { PostHog } from "posthog-node";
import { config } from "@/lib/config";

let client: PostHog | null = null;

export function getPosthogServer(): PostHog | null {
  if (!config.posthog.key) return null;
  if (client) return client;
  client = new PostHog(config.posthog.key, { host: config.posthog.host });
  return client;
}
