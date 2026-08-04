"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  checkoutPriceSchema,
  formatPriceUsd,
  PRO_ANNUAL_MONTHLY_EQUIVALENT_CENTS,
  PRO_ANNUAL_SAVINGS_CENTS,
  PRO_PRICE_CENTS,
  PRO_TRIAL_DAYS,
  type CheckoutPrice,
} from "@talysman/product";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Props = {
  freeFeatures: string[];
  proFeatures: string[];
  /** Whether to advertise the trial. Server-checked; Checkout re-checks authoritatively. */
  trialAvailable: boolean;
  /** Set when the visitor already pays — the Pro CTA becomes a no-op label. */
  alreadyPro?: boolean;
};

const BILLING_CYCLES: { price: CheckoutPrice; label: string }[] = [
  { price: "yearly", label: "Annual" },
  { price: "monthly", label: "Monthly" },
];

/** `?plan=` survives the signup round-trip, so honour it as the preselected cycle. */
function cycleFromParam(value: string | null): CheckoutPrice | null {
  const parsed = checkoutPriceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function PricingPlans({ freeFeatures, proFeatures, trialAvailable, alreadyPro }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedCycle = cycleFromParam(searchParams.get("plan"));

  // Annual leads: it is the better deal and the one the page argues for.
  const [cycle, setCycle] = useState<CheckoutPrice>(requestedCycle ?? "yearly");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCheckout = useCallback(
    async (price: CheckoutPrice) => {
      setError(null);
      setPending(true);
      const client = supabaseBrowser();
      const { data } = await client.auth.getSession();
      if (!data.session) {
        // Come back here with the cycle intact so the choice isn't made twice.
        router.push(`/signup?next=${encodeURIComponent(`/pricing?plan=${price}`)}`);
        return;
      }
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ price }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Checkout failed — please try again");
        setPending(false);
        return;
      }
      const { url } = (await res.json()) as { url: string };
      window.location.assign(url);
    },
    [router],
  );

  // Returning from signup with a chosen plan resumes checkout rather than making the
  // visitor click the same button a second time. The ref guard means a re-render (or a
  // new `startCheckout` identity) can never fire a second redirect.
  const resumed = useRef(false);
  useEffect(() => {
    if (!requestedCycle || alreadyPro || resumed.current) return;
    resumed.current = true;
    let cancelled = false;
    void (async () => {
      const { data } = await supabaseBrowser().auth.getSession();
      if (!cancelled && data.session) void startCheckout(requestedCycle);
    })();
    return () => {
      cancelled = true;
    };
  }, [requestedCycle, alreadyPro, startCheckout]);

  const annualEquivalent = formatPriceUsd(PRO_ANNUAL_MONTHLY_EQUIVALENT_CENTS);
  const isAnnual = cycle === "yearly";

  const proCta = alreadyPro
    ? "You're on Pro"
    : trialAvailable
      ? `Try Pro free for ${PRO_TRIAL_DAYS} days`
      : isAnnual
        ? "Subscribe annually"
        : "Subscribe monthly";

  return (
    <div className="plans">
      <article className="plan plan--free">
        <header className="plan__head">
          <h2 className="plan__name">Talysman Free</h2>
          <p className="plan__price">
            $0 <span className="plan__price-unit">forever</span>
          </p>
          <p className="plan__pitch">
            Experience the physical-key blocking mechanism, start to finish.
          </p>
        </header>
        <ul className="plan__features">
          {freeFeatures.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <button
          type="button"
          className="plan__cta"
          onClick={() => router.push("/download")}
        >
          Start focusing free
        </button>
        <p className="plan__footnote">No account required to install. No card, ever.</p>
      </article>

      <article className="plan plan--pro">
        <span className="plan__badge">Everything unlocked</span>
        <header className="plan__head">
          <h2 className="plan__name">Talysman Pro</h2>
          <p className="plan__pitch">
            For making focused work a repeatable part of your week.
          </p>

          <div
            className="cycle"
            role="radiogroup"
            aria-label="Billing period"
          >
            {BILLING_CYCLES.map(({ price, label }) => (
              <button
                key={price}
                type="button"
                role="radio"
                aria-checked={cycle === price}
                className={`cycle__option${cycle === price ? " cycle__option--on" : ""}`}
                onClick={() => setCycle(price)}
              >
                {label}
                {price === "yearly" ? (
                  <span className="cycle__save">
                    Save {formatPriceUsd(PRO_ANNUAL_SAVINGS_CENTS)}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {/* The point of stating both figures: nobody should have to divide by twelve. */}
          <p className="plan__price">
            {isAnnual ? annualEquivalent : formatPriceUsd(PRO_PRICE_CENTS.monthly)}
            <span className="plan__price-unit">/month</span>
          </p>
          <p className="plan__price-detail">
            {isAnnual ? (
              <>
                {formatPriceUsd(PRO_PRICE_CENTS.yearly)} billed annually ·{" "}
                <strong>save {formatPriceUsd(PRO_ANNUAL_SAVINGS_CENTS)} a year</strong>
              </>
            ) : (
              <>Billed monthly · cancel anytime</>
            )}
          </p>
        </header>

        <p className="plan__includes">Pro includes:</p>
        <ul className="plan__features">
          {proFeatures.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>

        <button
          type="button"
          className="plan__cta plan__cta--primary"
          onClick={() => startCheckout(cycle)}
          disabled={pending || alreadyPro}
        >
          {pending ? "Loading…" : proCta}
        </button>
        <p className="plan__footnote">
          {alreadyPro ? (
            <>Manage billing from your account page.</>
          ) : trialAvailable ? (
            <>
              Card required to start · nothing charged for {PRO_TRIAL_DAYS} days · cancel during
              the trial and you pay nothing
            </>
          ) : (
            <>Cancel anytime · you keep Pro until the period you paid for ends</>
          )}
        </p>
        {error ? <p className="plan__error">{error}</p> : null}
      </article>
    </div>
  );
}
