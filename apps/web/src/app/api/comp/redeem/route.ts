import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { redeemCompCode } from "@/lib/comp/redeem";
import { captureException } from "@/lib/sentry";

/** Cookie-authenticated redemption, used by the unlisted /redeem page. */
export async function POST(request: NextRequest) {
  const user = await requireUser();
  try {
    const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
    const code = typeof body?.code === "string" ? body.code : "";
    const result = await redeemCompCode({
      userId: user.id,
      code,
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });
    const status = result.outcome === "rate_limited" ? 429 : 200;
    return NextResponse.json(result, { status });
  } catch (err) {
    await captureException(err, { userId: user.id, route: "comp/redeem" });
    return NextResponse.json({ error: "Could not redeem that code" }, { status: 500 });
  }
}
