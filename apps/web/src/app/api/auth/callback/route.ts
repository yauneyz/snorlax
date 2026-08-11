import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { config } from "@/lib/config";
import { authRedirectTarget, safeInternalPath } from "@/lib/auth/redirects";
import { ANALYTICS_ANON_COOKIE, parseAnonId } from "@/lib/analytics/anon-id";
import { track } from "@/server/analytics/track";

function errorRedirect(code: string, next: string, flow: string | null): NextResponse {
  const target = new URL(flow === "signup" ? "/signup" : "/login", config.app.url);
  target.searchParams.set("error", code);
  if (flow !== "signup") target.searchParams.set("next", safeInternalPath(next));
  return NextResponse.redirect(target);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/app";
  const flow = searchParams.get("flow");
  const oauthError = searchParams.get("error");

  if (oauthError) return errorRedirect(oauthError, next, flow);
  if (!code) return errorRedirect("missing_code", next, flow);

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return errorRedirect("exchange_failed", next, flow);
  }

  const userId = data?.session?.user.id ?? data?.user?.id;
  if (userId) {
    await track({
      event: flow === "signup" ? "account_created" : "signed_in",
      source: "web",
      anonId: parseAnonId(request.cookies.get(ANALYTICS_ANON_COOKIE)?.value),
      userId,
      props: { method: "google", surface: "web" },
    });
  }

  return NextResponse.redirect(authRedirectTarget(config.app.url, next));
}
