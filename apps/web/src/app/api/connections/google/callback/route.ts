import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/config";
import { requireSubscribed } from "@/lib/auth/require-subscribed";
import { upsertGoogleConnection } from "@/lib/connections/store";
import { emailFromIdToken, exchangeCode } from "@/lib/google/oauth";
import { verifyState } from "@/lib/oauth/state";

const STATE_COOKIE = "oauth_state";
const RETURN_DEFAULT = "/app/data-sources/gsc";

function redirectWithError(origin: string, returnTo: string, error: string): NextResponse {
  const url = new URL(returnTo, origin);
  url.searchParams.set("error", error);
  const res = NextResponse.redirect(url);
  res.cookies.delete(STATE_COOKIE);
  return res;
}

export async function GET(request: NextRequest) {
  const { user } = await requireSubscribed();

  const url = new URL(request.url);
  const origin = config.app.url;
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const cookieState = request.cookies.get(STATE_COOKIE)?.value ?? null;

  if (oauthError) {
    return redirectWithError(origin, RETURN_DEFAULT, oauthError);
  }
  if (!code || !stateParam || !cookieState) {
    return redirectWithError(origin, RETURN_DEFAULT, "missing_state");
  }
  if (stateParam !== cookieState) {
    return redirectWithError(origin, RETURN_DEFAULT, "state_mismatch");
  }
  const verified = verifyState(stateParam);
  if (!verified) {
    return redirectWithError(origin, RETURN_DEFAULT, "bad_signature");
  }

  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch {
    return redirectWithError(origin, RETURN_DEFAULT, "code_exchange_failed");
  }

  const email = emailFromIdToken(tokens.id_token) ?? user.email ?? "google";
  await upsertGoogleConnection({
    userId: user.id,
    label: email,
    tokens,
    meta: { status: "active" },
  });

  const returnTo = verified.returnTo ?? RETURN_DEFAULT;
  const res = NextResponse.redirect(new URL(returnTo, origin));
  res.cookies.delete(STATE_COOKIE);
  return res;
}
