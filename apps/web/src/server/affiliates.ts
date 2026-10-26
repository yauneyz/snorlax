/**
 * Affiliate links: https://www.talysman.app/r/<slug> (migration 0020).
 *
 * The link itself records nothing. It redirects to the affiliate's landing page with
 * `utm_source=<slug>&utm_medium=affiliate`, and that page's ordinary page_viewed carries the
 * UTMs through BotID and the normal ingest path, where analytics_link() stamps the affiliate
 * onto the person. Recording on the redirect would count every crawler and link-preview fetch
 * (see the GET handler in api/desktop/download/route.ts for how badly that went once).
 *
 * Affiliates are created and edited only by the local `pnpm affiliates` app.
 */
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { captureException } from "@/lib/sentry";

export const AFFILIATE_MEDIUM = "affiliate";

const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;

/** Same shape the migration's check constraint enforces; re-checked so a bad row can't open a redirect. */
export function isInternalPath(path: string): boolean {
  return /^\/([^/\\]|$)/.test(path);
}

/** Where /r/<slug> sends a visitor: the landing path tagged with the affiliate's UTMs. */
export function affiliateLandingUrl(
  origin: string,
  affiliate: { slug: string; landing_path: string },
): URL {
  const url = new URL(isInternalPath(affiliate.landing_path) ? affiliate.landing_path : "/", origin);
  url.searchParams.set("utm_source", affiliate.slug);
  url.searchParams.set("utm_medium", AFFILIATE_MEDIUM);
  url.searchParams.set("utm_campaign", "affiliate");
  return url;
}

/** The active affiliate for a slug, or null for an unknown, paused, or malformed one. */
export async function findActiveAffiliate(
  rawSlug: string,
): Promise<{ slug: string; landing_path: string } | null> {
  const slug = rawSlug.toLowerCase();
  if (!SLUG.test(slug)) return null;
  try {
    const { data, error } = await supabaseAdmin()
      .from("affiliates")
      .select("slug, landing_path")
      .eq("slug", slug)
      .eq("active", true)
      .maybeSingle();
    if (error) throw new Error(`affiliate lookup failed: ${error.message}`);
    return data;
  } catch (err) {
    // A lookup failure still lands the visitor on the home page; only the credit is lost.
    await captureException(err, { scope: "affiliates.findActiveAffiliate", slug });
    return null;
  }
}
