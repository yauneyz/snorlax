import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/config";
import { requireSubscribed } from "@/lib/auth/require-subscribed";
import { buildAuthUrl } from "@/lib/google/oauth";
import { signState } from "@/lib/oauth/state";

const STATE_COOKIE = "oauth_state";

export async function GET(_request: NextRequest) {
  await requireSubscribed();

  const nonce = randomUUID();
  const state = signState({ nonce, returnTo: "/app/data-sources/gsc" });
  const url = buildAuthUrl({ state });

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: config.app.environment === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 5 * 60,
  });
  return res;
}
