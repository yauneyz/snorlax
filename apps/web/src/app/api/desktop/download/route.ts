import { NextRequest, NextResponse } from "next/server";

import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Redirects to desktop installers hosted in the release-artifacts S3 bucket. Installers live under
 * the `app/` prefix; the public download page (`/download`) links here so the canonical URL stays
 * on our domain while the bytes are served from S3.
 *
 * Usage: `/api/desktop/download?platform=win` → 302 to the S3 object.
 */

type Platform = "win" | "mac" | "linux";

// Stable names the release upload step (scripts/upload-release.mjs) publishes to; the versioned
// electron-builder artifacts from `pnpm build:win|mac|linux` are uploaded under these keys.
const INSTALLERS: Record<Platform, string> = {
  win: "Talysman-Setup.exe",
  mac: "Talysman.dmg",
  linux: "Talysman.deb",
};

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export async function GET(request: NextRequest) {
  const platform = request.nextUrl.searchParams.get("platform");
  if (platform !== "win" && platform !== "mac" && platform !== "linux") {
    return new NextResponse("Unknown platform", { status: 404 });
  }

  const file = INSTALLERS[platform];
  const s3Url = `${normalizeBaseUrl(config.extensionHosting.publicS3BaseUrl)}/app/${file}`;
  return NextResponse.redirect(s3Url, { status: 302 });
}
