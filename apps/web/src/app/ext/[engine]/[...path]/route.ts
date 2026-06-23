import { NextRequest, NextResponse } from "next/server";

import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExtensionEngine = "chromium" | "firefox";
type ExtensionArtifact = {
  contentType: string;
  kind: "metadata" | "binary";
};

const artifacts: Record<ExtensionEngine, Array<[RegExp, ExtensionArtifact]>> = {
  chromium: [
    [/^updates\.xml$/, { kind: "metadata", contentType: "application/xml; charset=utf-8" }],
    [
      /^focuslock-[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?\.crx$/,
      { kind: "binary", contentType: "application/x-chrome-extension" },
    ],
  ],
  firefox: [
    [/^updates\.json$/, { kind: "metadata", contentType: "application/json; charset=utf-8" }],
    [
      /^focuslock-[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?\.xpi$/,
      { kind: "binary", contentType: "application/x-xpinstall" },
    ],
  ],
};

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolveArtifact(engine: string, segments: string[]) {
  if (engine !== "chromium" && engine !== "firefox") return null;
  if (segments.length !== 1) return null;

  const file = segments[0];
  if (!file || file.includes("/") || file.includes("..")) return null;

  const artifact = artifacts[engine].find(([pattern]) => pattern.test(file))?.[1];
  if (!artifact) return null;

  const objectPath = `ext/${engine}/${file}`;
  const s3Url = `${normalizeBaseUrl(config.extensionHosting.publicS3BaseUrl)}/${objectPath}`;
  return { artifact, s3Url };
}

async function handleRequest(
  request: NextRequest,
  context: { params: Promise<{ engine: string; path: string[] }> },
  method: "GET" | "HEAD",
) {
  const { engine, path } = await context.params;
  const resolved = resolveArtifact(engine, path);
  if (!resolved) return new NextResponse("Not found", { status: 404 });

  const { artifact, s3Url } = resolved;
  if (artifact.kind === "binary") {
    return NextResponse.redirect(s3Url, { status: method === "HEAD" ? 308 : 302 });
  }

  const upstream = await fetch(s3Url, {
    method,
    cache: "no-store",
    headers: {
      "user-agent": request.headers.get("user-agent") ?? "FocusLock extension update check",
    },
  });

  if (upstream.status === 404) return new NextResponse("Not found", { status: 404 });
  if (!upstream.ok) {
    return new NextResponse("Extension metadata unavailable", { status: 502 });
  }

  return new NextResponse(method === "HEAD" ? null : await upstream.arrayBuffer(), {
    status: 200,
    headers: {
      "content-type": artifact.contentType,
      "cache-control": "no-cache",
    },
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ engine: string; path: string[] }> },
) {
  return handleRequest(request, context, "GET");
}

export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ engine: string; path: string[] }> },
) {
  return handleRequest(request, context, "HEAD");
}
