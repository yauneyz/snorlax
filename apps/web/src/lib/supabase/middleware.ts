import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { config } from "@/lib/config";

/**
 * Creates a Supabase client bound to the current request and response. Must be
 * called from `src/middleware.ts` — the returned response is sent to the client
 * with any refreshed auth cookies.
 */
export function supabaseMiddleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const client = createServerClient(config.supabase.url, config.supabase.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll().map((c) => ({ name: c.name, value: c.value }));
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options as CookieOptions);
        }
      },
    },
  });

  return { client, response: () => response };
}
