import type { Metadata } from "next";
import Link from "next/link";
import { ManageBillingButton } from "@/components/app/ManageBillingButton";
import { requireUser } from "@/lib/auth/require-user";
import { supabaseServer } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/supabase/types";

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const user = await requireUser();
  const supabase = await supabaseServer();
  const [{ data: profile }, { data: subscriptions }, { data: grants }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name,email,avatar_url")
      .eq("id", user.id)
      .single<Pick<ProfileRow, "full_name" | "email" | "avatar_url">>(),
    supabase.from("active_subscriptions").select("*").eq("user_id", user.id).limit(1),
    // Comped accounts (see migration 0004) have no Stripe customer, so the
    // billing portal would throw for them — show the plan, hide the button.
    supabase
      .from("active_entitlements")
      .select("current_period_end")
      .eq("user_id", user.id)
      .eq("source", "grant")
      .limit(1),
  ]);
  const subscription = subscriptions?.[0];
  const grant = grants?.[0];

  return (
    <section className="account">
      <h1>Account</h1>
      <dl className="account__details">
        <dt>Name</dt>
        <dd>{profile?.full_name ?? "—"}</dd>
        <dt>Email</dt>
        <dd>{profile?.email ?? user.email}</dd>
        <dt>Plan</dt>
        <dd>
          {subscription
            ? subscription.price_id
            : grant
              ? "Pro (complimentary)"
              : "Not subscribed"}
        </dd>
        {subscription ? (
          <>
            <dt>Renews</dt>
            <dd>{new Date(subscription.current_period_end).toLocaleDateString()}</dd>
          </>
        ) : grant?.current_period_end ? (
          <>
            <dt>Ends</dt>
            <dd>{new Date(grant.current_period_end).toLocaleDateString()}</dd>
          </>
        ) : null}
      </dl>
      {subscription ? (
        <ManageBillingButton />
      ) : grant ? null : (
        <Link href="/pricing" className="account__subscribe">
          Choose a plan
        </Link>
      )}
    </section>
  );
}
