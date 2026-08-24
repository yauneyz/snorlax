/**
 * The web <-> desktop identity bridge (analytics-arch.md §4.3).
 *
 * §4.3 assumed the desktop's system-browser hops already landed on our own domain under
 * `/api/desktop/*`, so the `tal_aid` cookie and a `?d=<device_id>` query param would arrive
 * together for free. They do not: `signInWithGoogle` opens Supabase's OAuth URL and
 * `startCheckout` / `openBillingPortal` open Stripe URLs — the browser never touches
 * talysman.app, and a cookie cannot ride inside those redirects.
 *
 * So this route *is* the hop. The desktop opens `/api/desktop/bridge?d=<device_id>&to=<url>`
 * instead of the target directly; we record the edge and 302 onward. One extra redirect buys
 * the exact web<->desktop link for everyone who signs in or subscribes from the app.
 *
 * `to` is an open-redirect surface, so it is checked against a host allowlist rather than
 * merely parsed. An unrecognised host is a bug in our own URL construction and answers 400 —
 * redirecting to an unvalidated destination is the one outcome worth refusing outright.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { config } from "@/lib/config";
import { ANALYTICS_ANON_COOKIE, parseAnonId } from "@/lib/analytics/anon-id";
import { linkIdentifiers } from "@/server/analytics/track";
import { attributionFromRequest } from "@/server/analytics/ingest";

export const runtime = "nodejs";

const deviceId = z.string().uuid();

function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Hosts the desktop is allowed to send a browser to through this route: Stripe (checkout and
 * the billing portal), our Supabase project (the OAuth consent hop), and our own domain.
 */
export function isAllowedDestination(
  target: string,
  appUrl: string = config.app.url,
  supabaseUrl: string = config.supabase.url,
): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  // Anything but https can carry a scheme-relative or javascript: payload past a naive host
  // check; the destinations we actually use are all https.
  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  if (host === "stripe.com" || host.endsWith(".stripe.com")) return true;

  const supabaseHost = hostOf(supabaseUrl);
  if (supabaseHost && host === supabaseHost) return true;

  const appHost = hostOf(appUrl);
  if (appHost && host === appHost) return true;

  return false;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const to = searchParams.get("to") ?? "";
  const parsedDevice = deviceId.safeParse(searchParams.get("d") ?? "");

  if (!isAllowedDestination(to)) {
    return NextResponse.json({ error: "destination not allowed" }, { status: 400 });
  }

  // A malformed device id costs the link, never the user's checkout: fall through to the
  // redirect rather than failing the flow the person actually asked for.
  if (parsedDevice.success) {
    await linkIdentifiers({
      anonId: parseAnonId(request.cookies.get(ANALYTICS_ANON_COOKIE)?.value),
      deviceId: parsedDevice.data,
      attribution: attributionFromRequest(request, {}),
    });
  }

  return NextResponse.redirect(to, 302);
}
