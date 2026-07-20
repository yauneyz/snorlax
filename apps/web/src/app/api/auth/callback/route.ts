import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { config } from "@/lib/config";
import { authRedirectTarget, safeInternalPath } from "@/lib/auth/redirects";

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
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return errorRedirect("exchange_failed", next, flow);
  }

  return NextResponse.redirect(authRedirectTarget(config.app.url, next));
}
