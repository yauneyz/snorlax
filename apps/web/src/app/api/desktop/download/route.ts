import { NextRequest, NextResponse } from "next/server";
import { checkBotId } from "botid/server";
import { z } from "zod";

import { config } from "@/lib/config";
import { downloadSource } from "@/lib/content/intent";
import { installerFile, parseDownloadTarget, type DownloadTarget } from "@/lib/downloads";
import { ANALYTICS_ANON_COOKIE, parseAnonId } from "@/lib/analytics/anon-id";
import { attributionFromRequest, classifyUserAgent } from "@/server/analytics/ingest";
import { track } from "@/server/analytics/track";
import { supabaseServer } from "@/lib/supabase/server";
import { sendInsightsPush } from "@/server/insights/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Desktop installers, hosted in the release-artifacts S3 bucket under the `app/` prefix (see
 * src/lib/downloads.ts for the file names). The canonical URL stays on our domain while the
 * bytes are served from S3.
 *
 *   GET  /api/desktop/download?platform=win|mac|linux[&format=deb|rpm|pacman]
 *        302 to the installer. Deliberately untracked: anything can fetch a URL, and when this
 *        route recorded every hit, one scraper requesting it 702 times in five minutes (and
 *        crawlers walking all three platforms) buried the real download count.
 *
 *   POST /api/desktop/download  { platform, format?, from? }  ->  { url }
 *        Called by the post-download page (/download/start) from a real browser. BotID's
 *        client challenge is attached to this request (see layout.tsx), so only a verified
 *        human is recorded as `download_clicked`. The installer URL is returned either way: a
 *        false positive costs a data point, never a download.
 */

function installerUrl(target: DownloadTarget): string {
  const base = config.extensionHosting.publicS3BaseUrl.replace(/\/+$/, "");
  return `${base}/app/${installerFile(target)}`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const target = parseDownloadTarget(searchParams.get("platform"), searchParams.get("format"));
  if (!target) return new NextResponse("Unknown platform", { status: 404 });
  return NextResponse.redirect(installerUrl(target), { status: 302 });
}

const startBody = z.object({
  platform: z.string(),
  format: z.string().nullish(),
  from: z.string().nullish(),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = startBody.safeParse(body);
  const target = parsed.success
    ? parseDownloadTarget(parsed.data.platform, parsed.data.format)
    : null;
  if (!parsed.success || !target) {
    return NextResponse.json({ error: "unknown platform" }, { status: 404 });
  }

  const url = installerUrl(target);
  const botId = await checkBotId();
  if (botId.isBot || classifyUserAgent(request.headers.get("user-agent")) === "bot") {
    return NextResponse.json({ url });
  }

  const from = downloadSource(parsed.data.from);
  const props = {
    platform: target.platform,
    ...(target.format ? { format: target.format } : {}),
    ua_class: "human" as const,
    ...(from ? { from } : {}),
  };

  // Signed-in visitors get their download attributed to `user_id`, not just the anon cookie:
  // the cookie can churn (cleared, different browser/device) across repeat downloads, which
  // would otherwise fragment one person into several "visitors" in the funnel. `getUser()` is a
  // no-op when there's no session cookie, so anonymous traffic pays no extra round trip.
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  await track({
    event: "download_clicked",
    source: "server",
    anonId: parseAnonId(request.cookies.get(ANALYTICS_ANON_COOKIE)?.value),
    userId: data.user?.id ?? null,
    platform: target.platform,
    attribution: attributionFromRequest(request, props),
    props,
  });
  await sendInsightsPush({ type: "download", platform: target.platform });
  return NextResponse.json({ url });
}
