import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { affiliateLandingUrl, findActiveAffiliate } from "@/server/affiliates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /r/<slug> — an affiliate link. See src/server/affiliates.ts.
 *
 * 307 rather than 308 so a browser never caches the hop: pausing an affiliate must take effect
 * for people who already clicked once. An unknown or paused slug still lands on the home page,
 * just without credit, so a stale link in an old video never 404s. Targets the canonical app
 * URL rather than the request's origin, which is the bind address under `next dev`.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const affiliate = await findActiveAffiliate(slug);
  const target = affiliate
    ? affiliateLandingUrl(config.app.url, affiliate)
    : new URL("/", config.app.url);
  const response = NextResponse.redirect(target, { status: 307 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex");
  return response;
}
