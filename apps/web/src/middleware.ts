import { NextRequest, NextResponse } from "next/server";
import { supabaseMiddleware } from "@/lib/supabase/middleware";
import { classifyPath, isPasswordRecoveryPath } from "@/lib/auth/route-classification";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const kind = classifyPath(pathname);

  // Pass-through for assets and API routes; API handlers do their own auth.
  if (kind === "asset" || kind === "api") return NextResponse.next();

  const { client, response } = supabaseMiddleware(request);
  const {
    data: { user },
  } = await client.auth.getUser();

  let subscribed = false;
  if (user) {
    const { data } = await client
      .from("active_entitlements")
      .select("user_id")
      .eq("user_id", user.id)
      .limit(1);
    subscribed = (data?.length ?? 0) > 0;
  }

  const redirectTo = (to: string) => {
    const url = request.nextUrl.clone();
    url.pathname = to;
    url.search = "";
    return NextResponse.redirect(url);
  };

  if (kind === "app") {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(url);
    }
    if (pathname.startsWith("/app") && !subscribed) return redirectTo("/pricing");
    return response();
  }

  if (kind === "auth") {
    // A valid recovery code creates a session before the user sets the new password. Do not
    // redirect that session away from the form it still needs to complete.
    if (user && !isPasswordRecoveryPath(pathname)) return redirectTo("/app");
    return response();
  }

  // marketing: only `/` reroutes logged-in users; keep /pricing, /blog, etc. browsable.
  // Leave a root-level auth callback in place long enough for the browser client to consume it.
  // This matters when a recovery link is opened while another session cookie still exists.
  if (pathname === "/" && user && !request.nextUrl.searchParams.has("code")) {
    return redirectTo(subscribed ? "/app" : "/pricing");
  }

  return response();
}

export const config = {
  runtime: "nodejs",
  matcher: [
    // Everything except Next internals, the webhook (raw body), and OAuth
    // callbacks (must run before auth state exists).
    "/((?!_next/static|_next/image|favicon.ico|og-default.png|api/stripe/webhook|api/auth/callback|api/connections/google/callback).*)",
  ],
};
