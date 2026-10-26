import type { AnalyticsPersonRow } from "@/lib/supabase/types";

export type FirstTouch = Pick<
  AnalyticsPersonRow,
  "first_utm_source" | "first_utm_medium" | "first_referrer_host"
> & {
  /** The person's affiliate slug, when one earned them. Wins over first-touch. */
  affiliate_slug?: string | null;
};

const SEARCH_ENGINES: [RegExp, string][] = [
  [/(^|\.)google\./i, "google"],
  [/(^|\.)bing\.com$/i, "bing"],
  [/(^|\.)duckduckgo\.com$/i, "duckduckgo"],
  [/(^|\.)yahoo\./i, "yahoo"],
];

/**
 * A person's first-touch channel and medium. Must stay in step with the `channel`/`medium`
 * expressions in `analytics_channel_funnel` (migration 0020) so a push names the same bucket
 * the Channels panel counts it under.
 */
export function channelOf(person: FirstTouch): { channel: string; medium: string } {
  if (person.affiliate_slug) return { channel: person.affiliate_slug, medium: "affiliate" };
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
