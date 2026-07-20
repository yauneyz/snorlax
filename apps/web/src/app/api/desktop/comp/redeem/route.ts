import { NextRequest, NextResponse } from "next/server";
import { requireBearerUser, UnauthorizedError } from "@/lib/auth/require-bearer-user";
import { redeemCompCode } from "@/lib/comp/redeem";
import { captureException } from "@/lib/sentry";

/** Bearer-authenticated redemption, used by the desktop Account tab. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireBearerUser(request);
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
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    await captureException(err, { route: "desktop/comp/redeem" });
    return NextResponse.json({ error: "Could not redeem that code" }, { status: 500 });
  }
}
