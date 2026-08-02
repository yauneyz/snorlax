import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ManageBillingButton } from "@/components/app/ManageBillingButton";
import {
  ENTITLEMENT_GRACE_COOKIE,
  entitlementGraceCookieIsValid,
} from "@/lib/auth/entitlement-grace";
import { requireUser } from "@/lib/auth/require-user";
import { getSubscriptionDetailForUser } from "@/lib/stripe/subscription";
import { supabaseServer } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/supabase/types";

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const user = await requireUser();
  const supabase = await supabaseServer();
  const [{ data: profile }, detailResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name,email,avatar_url")
      .eq("id", user.id)
      .single<Pick<ProfileRow, "full_name" | "email" | "avatar_url">>(),
    getSubscriptionDetailForUser(user.id)
      .then((detail) => ({ detail, unavailable: false as const }))
      .catch(() => ({ detail: undefined, unavailable: true as const })),
  ]);
  const detail = detailResult.detail;
  const graceCookie = detailResult.unavailable
    ? (await cookies()).get(ENTITLEMENT_GRACE_COOKIE)?.value
    : undefined;
  const unavailableAccessIsInGrace =
    detailResult.unavailable &&
    (graceCookie === undefined || entitlementGraceCookieIsValid(graceCookie, user.id));
  const planLabel = detail
    ? detail.status === "comped"
      ? "Pro (complimentary)"
      : detail.hasSubscription
        ? detail.plan === "pro"
          ? detail.price
            ? `Pro (${detail.price === "yearly" ? "annual" : "monthly"})`
            : "Pro (billing plan unavailable)"
          : "Free (payment verification required)"
        : "Free"
    : unavailableAccessIsInGrace
      ? "Pro (verification pending)"
      : "Plan unavailable (verification required)";

  // The plan lives in its own panel, so the record on the left only carries the rest.
  const renewal =
    detail?.hasSubscription && detail.currentPeriodEnd
      ? {
          label: detail.cancelAtPeriodEnd ? "Cancels" : "Renews",
          date: new Date(detail.currentPeriodEnd).toLocaleDateString(),
        }
      : null;

  return (
    <section className="account">
      <h1>Account</h1>
      <div className="account__grid">
        <dl className="account__details">
          <dt>Name</dt>
          <dd>{profile?.full_name ?? "—"}</dd>
          <dt>Email</dt>
          <dd>{profile?.email ?? user.email}</dd>
          {detail?.status &&
          !["active", "trialing", "comped"].includes(detail.status) ? (
            <>
              <dt>Billing status</dt>
              <dd>{detail.status.replaceAll("_", " ")}</dd>
            </>
          ) : null}
        </dl>

        <aside className="account__plan">
          <span className="account__plan-eyebrow">Plan</span>
          <p className="account__plan-name">{planLabel}</p>
          {renewal ? (
            <p className="account__plan-meta">
              {renewal.label} {renewal.date}
            </p>
          ) : null}
          {detail?.hasSubscription ? (
            <div className="account__plan-actions">
              <ManageBillingButton />
            </div>
          ) : detailResult.unavailable || detail?.status === "comped" ? null : (
            <div className="account__plan-actions">
              <Link href="/pricing" className="account__subscribe">
                Upgrade to Pro
              </Link>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
