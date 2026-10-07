import type { Metadata } from "next";
import {
  formatPriceUsd,
  FREE_BLOCKED_SITE_LIMIT,
  LIFETIME_PRICE_CENTS,
  PRO_DEVICE_LIMIT,
  PRO_DEVICE_STALE_AFTER_DAYS,
  PRO_TRIAL_DAYS,
} from "@talysman/product";
import { PricingPlans } from "@/components/marketing/PricingPlans";
import { JsonLd, softwareApplicationJsonLd } from "@/components/seo/JsonLd";
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
  "Turn any USB drive into your physical key",
  `Block up to ${FREE_BLOCKED_SITE_LIMIT} distracting websites`,
  "Filter out algorithmic and recommended content",
  "Allow-only and block-all-internet modes",
  "Run unlimited manual focus sessions",
  "Your paired key is required to end a session early",
];

const proFeatures = [
  "Block unlimited websites",
  "Pre-made blocklists for social media, shopping, sports, NSFW, and more",
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
        Yes. Cancel before the trial ends and you are never charged — the app drops to Free, which
        keeps key-gated focus sessions and {FREE_BLOCKED_SITE_LIMIT} blocked websites. You do not
        lose the mechanism, only the parts that make it repeatable.
      </p>
    ),
  },
  {
    q: "Can I cancel at any time?",
    a: (
      <p>
        Yes, from your account page — no email, no retention call. Cancellation takes effect at the
        end of the period you have already paid for, and you keep Pro until then. During the trial,
        cancelling means no charge at all.
      </p>
    ),
  },
  {
    q: "Does one subscription cover all my computers?",
    a: (
      <p>
        Yes. Pro is tied to your account, not to a machine, and covers up to {PRO_DEVICE_LIMIT}{" "}
        computers at once. Install {config.app.name} on your laptop and your desktop, sign in with
        the same account on each, and pair the same USB drive on both — each computer keeps its own
        list of paired keys. Replacing a computer? Remove the old one from your account page, or it
        frees its spot by itself after {PRO_DEVICE_STALE_AFTER_DAYS} days unused. Free works on
        any number of computers.
      </p>
    ),
  },
  {
    q: "What happens to my schedules if I downgrade?",
    a: (
      <>
        <p>
          Scheduled windows are cleared and extra blocking profiles are deleted. Your active
          profile keeps up to {FREE_BLOCKED_SITE_LIMIT} blocked websites on Free; its extra blocked
          websites and Pro policy settings are saved on this computer and restored if you return to
          Pro. The profile you are actively using is always the one kept.
        </p>
        <p>
          One wrinkle worth knowing: loosening enforcement is key-gated like everything else, so if
          your key isn&apos;t plugged in when the downgrade lands, the stricter setup simply stays
          in force until it is. Nothing is silently unblocked behind your back.
        </p>
      </>
    ),
  },
  {
    q: "Do you offer a lifetime plan?",
    a: (
      <p>
        Yes. Lifetime is a single {formatPriceUsd(LIFETIME_PRICE_CENTS)} payment for Pro on your
        account, with no renewal. Monthly and annual plans are there if you&apos;d rather not pay up
        front.
      </p>
    ),
  },
  {
    q: "What do I actually need to buy?",
    a: (
      <p>
        Nothing but the plan. The physical key is a USB drive you already own — any one will
        do, and you can pair several so a lost drive isn&apos;t a lockout. There is no hardware to
        ship and nothing to wait for.
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
      <JsonLd data={softwareApplicationJsonLd()} />
      <section className="pricing__intro">
        <p className="section__eyebrow">Simple, honest pricing</p>
        <h1>
          Try the mechanism free.
          <br />
          Pay for the system.
        </h1>
        <p className="pricing__lede">
          Try the free version to block your most distracting sites. Reddit, YouTube, Instagram,
          whatever gets you. When you have proven that it works for you, upgrade to Pro to get
          unlimited sites, app blocking, pre-made lists, and schedules.
        </p>
        <ul className="pricing__promises" aria-label="Pricing assurances">
          <li>No hardware to buy</li>
          <li>Pro on up to {PRO_DEVICE_LIMIT} computers</li>
          <li>Cancel online</li>
        </ul>
      </section>

      {/* No Suspense boundary needed around `useSearchParams`: reading auth cookies above
          already makes this route dynamic, so it is never statically prerendered. */}
      <PricingPlans
        freeFeatures={freeFeatures}
        proFeatures={proFeatures}
        trialAvailable={trialAvailable}
        alreadyPro={detail?.plan === "pro"}
        alreadyLifetime={detail?.status === "lifetime"}
      />

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
