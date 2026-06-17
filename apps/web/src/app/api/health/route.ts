import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("throw") === "1") {
    throw new Error("Intentional health check error (Sentry smoke test)");
  }
  return NextResponse.json({ ok: true, ts: new Date().toISOString() });
}
