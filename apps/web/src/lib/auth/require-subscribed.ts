import { cache } from "react";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * RSC / route handler guard. Redirects unauthed → /login and unentitled → /pricing.
 * Returns { user, entitlement } when the user is entitled — by subscription or
 * by a complimentary grant.
 */
export const requireSubscribed = cache(async function requireSubscribed() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // `active_entitlements` covers paid subscriptions and complimentary grants alike.
  const { data: rows } = await supabase
    .from("active_entitlements")
    .select("*")
    .eq("user_id", user.id)
    .limit(1);

  const entitlement = rows?.[0];
  if (!entitlement) redirect("/pricing");

  return { user, entitlement };
});
