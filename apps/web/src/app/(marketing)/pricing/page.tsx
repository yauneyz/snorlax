import type { Metadata } from "next";
import Link from "next/link";
import { FREE_BLOCKED_SITE_LIMIT, PRO_TRIAL_DAYS } from "@talysman/product";
import { PricingPlans } from "@/components/marketing/PricingPlans";
import { config } from "@/lib/config";
import { supabaseServer } from "@/lib/supabase/server";
import { getSubscriptionDetailForUser, isTrialAvailableForUser } from "@/lib/stripe/subscription";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Start free, or try ${config.app.name} Pro free for ${PRO_TRIAL_DAYS} days. Unlimited website and app blocking, recurring focus schedules, and a physical key you can't click past.`,
  alternates: { canonical: `${config.app.url}/pricing` },
};

/**
 * Free is scoped around the activation event — pair a key, run a locked session — not
 * around a crippled blocklist. What it withholds is repeatability: schedules, extra
 * profiles, and app blocking.
 */
const freeFeatures = [
  "Pair any USB drive you already own",
  `Block up to ${FREE_BLOCKED_SITE_LIMIT} distracting websites`,
  "Allow-only and block-all-internet modes",
  "Run manual focus sessions, any length",
  "Your paired key is required to end a session early",
];

const proFeatures = [
  "Block unlimited websites",
  "Block distracting desktop apps, not just tabs",
  "Schedule recurring focus windows that arm themselves",
  "Unlimited blocking profiles for different kinds of work",
  "Lock a scheduled window so even the key won't end it early",
  "Every future Pro feature, included",
];

const faqs = [
  {
    q: `Can I keep using ${config.app.name} Free after the trial?`,
    a: (
      <p>
        Yes. Cancel before the trial ends and you are never charged — the app drops to Free,
        which keeps key-gated focus sessions and {FREE_BLOCKED_SITE_LIMIT} blocked websites. You
        do not lose the mechanism, only the parts that make it repeatable.
      </p>
    ),
  },
  {
    q: "Can I cancel at any time?",
    a: (
      <p>
        Yes, from your account page — no email, no retention call. Cancellation takes effect at
        the end of the period you have already paid for, and you keep Pro until then. During the
        trial, cancelling means no charge at all.
      </p>
    ),
  },
  {
    q: "Does one subscription cover all my computers?",
    a: (
      <p>
        Yes. Pro is tied to your account, not to a machine, and there is no device limit. Install{" "}
        {config.app.name} on your laptop and your desktop, sign in with the same account on each,
        and pair the same USB drive on both — each computer keeps its own list of paired keys.
      </p>
    ),
  },
  {
    q: "What happens to my schedules if I downgrade?",
    a: (
      <>
        <p>
          They are removed, not paused. When your plan drops to Free the app brings your setup
          back inside the Free limits: scheduled windows are cleared, extra blocking profiles are
          deleted, app blocks are dropped, and a blocklist longer than{" "}
          {FREE_BLOCKED_SITE_LIMIT} sites is trimmed. The profile you are actively using is
          always the one kept.
        </p>
        <p>
          One wrinkle worth knowing: loosening enforcement is key-gated like everything else, so
          if your key isn&apos;t plugged in when the downgrade lands, the stricter setup simply
          stays in force until it is. Nothing is silently unblocked behind your back.
        </p>
      </>
    ),
  },
  {
    q: "Do you offer a lifetime plan?",
    a: (
      <p>
        Not today. {config.app.name} is a subscription because the desktop service, the browser
        extensions, and the signing and notarization behind them are ongoing work, and a lifetime
        price that ignores that is a promise we would rather not make badly. If a founder
        lifetime offer happens, it will be announced on the{" "}
        <Link href="/blog">blog</Link> first.
      </p>
    ),
  },
  {
    q: "What do I actually need to buy?",
    a: (
      <p>
        Nothing but the subscription. The physical key is a USB drive you already own — any one
        will do, and you can pair several so a lost drive isn&apos;t a lockout. There is no
        hardware to ship and nothing to wait for.
      </p>
    ),
  },
];

export default async function PricingPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // A visitor who already pays should not be sold a trial they cannot have.
  const detail = user ? await getSubscriptionDetailForUser(user.id) : null;
  const trialAvailable = await isTrialAvailableForUser(user?.id ?? null);

  return (
    <div className="pricing">
      <section className="pricing__intro">
        <h1>Protect your focus before the next tab wins</h1>
        <p className="pricing__lede">
          Start free and experience a focus session you can&apos;t end with one impulsive click.
          Then try everything free for {PRO_TRIAL_DAYS} days.
        </p>
      </section>

      {/* No Suspense boundary needed around `useSearchParams`: reading auth cookies above
          already makes this route dynamic, so it is never statically prerendered. */}
      <PricingPlans
        freeFeatures={freeFeatures}
        proFeatures={proFeatures}
        trialAvailable={trialAvailable}
        alreadyPro={detail?.plan === "pro"}
      />

      <section className="assurance">
        <h2>Not sure it will work for you?</h2>
        <p>
          Try {config.app.name} during a real workweek. Pair a key, schedule your hardest work
          hours, and see what happens the first time you try to abandon a session. That moment —
          not the install — is the thing you are actually evaluating.
        </p>
        <p className="assurance__terms">
          The trial runs {PRO_TRIAL_DAYS} days and we email you before it ends. Cancel any time
          before then and you are not charged.
        </p>
      </section>

      <section className="faq faq--pricing" id="faq">
        <h2 className="section__title">Frequently asked questions</h2>
        <div className="faq__list">
          {faqs.map((faq) => (
            <details key={faq.q} className="faq__item">
              <summary>{faq.q}</summary>
              <div className="faq__answer">{faq.a}</div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
