import type { AnalyticsPersonRow } from "@/lib/supabase/types";

export type FirstTouch = Pick<
  AnalyticsPersonRow,
  "first_utm_source" | "first_utm_medium" | "first_referrer_host"
>;

const SEARCH_ENGINES: [RegExp, string][] = [
  [/(^|\.)google\./i, "google"],
  [/(^|\.)bing\.com$/i, "bing"],
  [/(^|\.)duckduckgo\.com$/i, "duckduckgo"],
  [/(^|\.)yahoo\./i, "yahoo"],
];

/**
 * A person's first-touch channel and medium. Must stay in step with the `channel`/`medium`
 * expressions in `analytics_channel_funnel` (migration 0012) so a push names the same bucket
 * the Channels panel counts it under.
 */
export function channelOf(person: FirstTouch): { channel: string; medium: string } {
  const host = person.first_referrer_host;
  const engine = host ? SEARCH_ENGINES.find(([pattern]) => pattern.test(host))?.[1] : undefined;
  return {
    channel: person.first_utm_source ?? engine ?? host ?? "direct",
    medium: person.first_utm_medium ?? (engine ? "organic" : host ? "referral" : "none"),
  };
}

/** "google (organic)", "reddit.com (referral)", or just "direct". */
export function channelLabel(person: FirstTouch): string {
  const { channel, medium } = channelOf(person);
  return medium === "none" ? channel : `${channel} (${medium})`;
}
