import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import mime from "mime-types";

export const runtime = "nodejs";

const RESOURCES_DIR = path.resolve(process.cwd(), "content", "blog", "resources");

export async function GET(_req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await context.params;
  if (!segments?.length) return new NextResponse("Not found", { status: 404 });

  const requested = path.resolve(RESOURCES_DIR, ...segments);
  // Block traversal (`..` segments resolving outside RESOURCES_DIR).
  if (!requested.startsWith(RESOURCES_DIR + path.sep) && requested !== RESOURCES_DIR) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  let buf: Buffer;
  try {
    buf = await fs.readFile(requested);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  const ext = path.extname(requested).slice(1);
  const contentType = mime.lookup(ext) || "application/octet-stream";
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=3600, immutable",
    },
  });
}
