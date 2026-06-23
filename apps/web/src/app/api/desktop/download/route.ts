import { NextRequest, NextResponse } from "next/server";

import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Redirects to the desktop installer hosted in the same S3 bucket as the browser-extension
 * artifacts (see `apps/web/src/app/ext/[engine]/[...path]/route.ts`). Installers live under the
 * `app/` prefix; the public download page (`/download`) links here so the canonical URL stays on
 * our domain while the bytes are served from S3.
 *
 * Usage: `/api/desktop/download?platform=win` → 302 to the S3 object.
 */

type Platform = "win" | "mac" | "linux";

// Conventional artifact names produced by `pnpm build:win|mac|linux` (electron-builder output).
const INSTALLERS: Record<Platform, string> = {
  win: "FocusLock-Setup.exe",
  mac: "FocusLock.dmg",
  linux: "FocusLock.AppImage",
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
