import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { config } from "@/lib/config";

/**
 * Supabase client for Server Components and Route Handlers. Uses the user's
 * cookies via `next/headers`.
 */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(config.supabase.url, config.supabase.publishableKey, {
    cookies: {
      getAll() {
        return store.getAll().map((c) => ({ name: c.name, value: c.value }));
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, options as CookieOptions);
          }
        } catch {
          // `set` throws when called from a pure Server Component — safe to
          // ignore because middleware already refreshes cookies.
        }
      },
    },
  });
}
