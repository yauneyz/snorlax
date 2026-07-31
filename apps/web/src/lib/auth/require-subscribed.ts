import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getUserEntitlement } from "@talysman/billing-server";
import {
  ENTITLEMENT_GRACE_COOKIE,
  entitlementGraceCookieIsValid,
} from "@/lib/auth/entitlement-grace";
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

  let entitlement;
  try {
    entitlement = await getUserEntitlement({ db: supabase, userId: user.id });
  } catch {
    const grace = (await cookies()).get(ENTITLEMENT_GRACE_COOKIE)?.value;
    // Middleware starts the first bounded lease on an unavailable read. An absent
    // cookie is accepted for this request so the response carrying it can complete.
    if (grace !== undefined && !entitlementGraceCookieIsValid(grace, user.id)) {
      redirect("/pricing");
    }
    entitlement = {
      active: true,
      plan: "pro" as const,
      source: "server" as const,
      status: "verification_unavailable",
    };
  }
  if (!entitlement.active) redirect("/pricing");

  return { user, entitlement };
});
