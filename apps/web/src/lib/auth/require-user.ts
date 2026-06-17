import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Server-side guard for RSC / Route Handlers.
 * Redirects anonymous requests to /login and returns the user for authed ones.
 */
export async function requireUser(redirectTo = "/login") {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(redirectTo);
  return user;
}
