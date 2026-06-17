import { cache } from "react";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * RSC / route handler guard. Redirects unauthed → /login and unsubscribed → /pricing.
 * Returns { user, subscription } when the user is entitled.
 */
export const requireSubscribed = cache(async function requireSubscribed() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: subs } = await supabase
    .from("active_subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .limit(1);

  const subscription = subs?.[0];
  if (!subscription) redirect("/pricing");

  return { user, subscription };
});
