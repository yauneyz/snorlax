import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "@/lib/config";
import type { Database } from "./database.types";

/**
 * Secret-key Supabase client. Bypasses RLS — only import from:
 *   - route handlers (src/app/api/**)
 *   - server-only library code (src/server/**, src/lib/stripe/**)
 * An eslint rule (`no-restricted-imports`) blocks it everywhere else.
 */
let adminClient: SupabaseClient<Database> | null = null;

export function supabaseAdmin(): SupabaseClient<Database> {
  if (adminClient) return adminClient;
  adminClient = createClient<Database>(config.supabase.url, config.supabase.secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return adminClient;
}
