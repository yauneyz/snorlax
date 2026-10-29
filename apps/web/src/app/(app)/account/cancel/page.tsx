import type { Metadata } from "next";
import Link from "next/link";
import { CancelSubscriptionButton } from "@/components/app/CancelSubscriptionButton";
import { requireUser } from "@/lib/auth/require-user";
import { config } from "@/lib/config";
import { getSubscriptionDetailForUser } from "@/lib/stripe/subscription";

export const metadata: Metadata = {
  title: "Cancel Pro",
  robots: { index: false, follow: false },
};

/**
 * The failed-payment email's cancel link. Loading the page only explains; cancelling is
 * an explicit click, so a prefetch or link scanner can't end someone's subscription.
 */
export default async function CancelPage() {
  const user = await requireUser();
  const detail = await getSubscriptionDetailForUser(user.id);
  const appName = config.app.name;
  const unpaid = ["past_due", "unpaid", "incomplete"].includes(detail.status ?? "");

  let body: React.ReactNode;
  if (!detail.hasSubscription) {
    body = (
      <p>
        You don&apos;t have a {appName} Pro subscription, so there&apos;s nothing to cancel and
        nothing more will be charged. You&apos;re on {appName} Free.
      </p>
    );
  } else if (detail.cancelAtPeriodEnd) {
    body = (
      <p>
        Your {appName} Pro subscription is already cancelled
        {detail.currentPeriodEnd
          ? ` and ends on ${new Date(detail.currentPeriodEnd).toLocaleDateString()}`
          : ""}
        . You won&apos;t be charged again.
      </p>
    );
  } else {
    body = (
      <>
        <p>
          {unpaid
            ? `Your last renewal didn't go through. Cancelling ends Pro now, we stop retrying the payment, and you won't owe anything for it.`
            : `Pro stays on until the end of the period you've already paid for, and you won't be charged again.`}
        </p>
        <p>
          You&apos;ll keep {appName} Free. Note that scheduled windows and extra blocking profiles
          are removed on the way down.
        </p>
        <div className="account__plan-actions">
          <CancelSubscriptionButton />
        </div>
      </>
    );
  }

  return (
    <section className="account">
      <h1>Cancel {appName} Pro</h1>
      {body}
      <p>
        <Link href="/account">Back to your account</Link>
      </p>
    </section>
  );
}
