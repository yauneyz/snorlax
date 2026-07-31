import { NextRequest, NextResponse } from "next/server";
import { getUserEntitlement } from "@talysman/billing-server";
import { ENTITLEMENT_GRACE_PERIOD_MS } from "@talysman/product";
import { supabaseMiddleware } from "@/lib/supabase/middleware";
import { classifyPath, isPasswordRecoveryPath } from "@/lib/auth/route-classification";
import {
  createEntitlementGraceCookie,
  ENTITLEMENT_GRACE_COOKIE,
  entitlementGraceCookieIsValid,
} from "@/lib/auth/entitlement-grace";

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
  let graceCookie: string | null | undefined;
  if (user) {
    const existingGrace = request.cookies.get(ENTITLEMENT_GRACE_COOKIE)?.value;
    try {
      const entitlement = await getUserEntitlement({ db: client, userId: user.id });
      subscribed = entitlement.active;
      graceCookie = subscribed
        ? createEntitlementGraceCookie(
            user.id,
            entitlement.fetchedAt ?? new Date().toISOString(),
          )
        : null;
    } catch {
      // A read outage is the same uncertainty as desktop being offline. A valid prior
      // verification keeps working; the first unavailable read starts one bounded lease.
      subscribed =
        entitlementGraceCookieIsValid(existingGrace, user.id) || existingGrace === undefined;
      if (subscribed && existingGrace === undefined) {
        graceCookie = createEntitlementGraceCookie(user.id, new Date().toISOString());
      } else if (existingGrace !== undefined) {
        // Preserve the original signed timestamp (including after it expires) so the
        // browser does not discard the marker and accidentally start a second lease.
        graceCookie = existingGrace;
      }
    }
  } else {
    graceCookie = null;
  }

  const finish = (result: NextResponse) => {
    if (graceCookie === null) {
      result.cookies.delete(ENTITLEMENT_GRACE_COOKIE);
    } else if (graceCookie) {
      result.cookies.set(ENTITLEMENT_GRACE_COOKIE, graceCookie, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        // Keep the signed timestamp around after expiry so an outage cannot start
        // a fresh lease merely because the browser discarded the cookie.
        maxAge: Math.ceil(ENTITLEMENT_GRACE_PERIOD_MS / 1000) + 7 * 24 * 60 * 60,
      });
    }
    return result;
  };

  const redirectTo = (to: string) => {
    const url = request.nextUrl.clone();
    url.pathname = to;
    url.search = "";
    return finish(NextResponse.redirect(url));
  };

  if (kind === "app") {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?next=${encodeURIComponent(pathname)}`;
      return finish(NextResponse.redirect(url));
    }
    if (pathname.startsWith("/app") && !subscribed) return redirectTo("/pricing");
    return finish(response());
  }

  if (kind === "auth") {
    // A valid recovery code creates a session before the user sets the new password. Do not
    // redirect that session away from the form it still needs to complete.
    if (user && !isPasswordRecoveryPath(pathname)) return redirectTo("/app");
    return finish(response());
  }

  // marketing: only `/` reroutes logged-in users; keep /pricing, /blog, etc. browsable.
  // Leave a root-level auth callback in place long enough for the browser client to consume it.
  // This matters when a recovery link is opened while another session cookie still exists.
  if (pathname === "/" && user && !request.nextUrl.searchParams.has("code")) {
    return redirectTo(subscribed ? "/app" : "/pricing");
  }

  return finish(response());
}

export const config = {
  runtime: "nodejs",
  matcher: [
    // Everything except Next internals, the webhook (raw body), and the auth
    // callback (must run before auth state exists).
    "/((?!_next/static|_next/image|favicon.ico|og-default.png|api/stripe/webhook|api/auth/callback).*)",
  ],
};
