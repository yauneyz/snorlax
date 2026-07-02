import { NextRequest, NextResponse } from "next/server";
import { DESKTOP_DEEP_LINK_SCHEME } from "@talysman/auth-contracts";
import { supabaseServer } from "@/lib/supabase/server";

function redirectTarget(origin: string, next: string): string {
  if (next.startsWith("/")) return `${origin}${next}`;

  try {
    const parsed = new URL(next);
    if (parsed.protocol === `${DESKTOP_DEEP_LINK_SCHEME}:`) return parsed.toString();
  } catch {
    return `${origin}/app`;
  }

  return `${origin}/app`;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/app";

  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
    }
  }

  return NextResponse.redirect(redirectTarget(origin, next));
}
