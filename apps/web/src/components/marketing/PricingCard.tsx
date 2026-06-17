"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Props = {
  plan: "monthly" | "yearly";
  title: string;
  priceLabel: string;
  features: string[];
};

export function PricingCard({ plan, title, priceLabel, features }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubscribe = async () => {
    setError(null);
    setPending(true);
    const client = supabaseBrowser();
    const { data } = await client.auth.getSession();
    if (!data.session) {
      router.push(`/signup?next=${encodeURIComponent(`/pricing?plan=${plan}`)}`);
      return;
    }
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ price: plan }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Checkout failed");
      setPending(false);
      return;
    }
    const { url } = (await res.json()) as { url: string };
    window.location.assign(url);
  };

  return (
    <article className={`pricing-card pricing-card--${plan}`}>
      <h2>{title}</h2>
      <p className="pricing-card__price">{priceLabel}</p>
      <ul className="pricing-card__features">
        {features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <button type="button" className="pricing-card__cta" onClick={onSubscribe} disabled={pending}>
        {pending ? "Loading…" : "Subscribe"}
      </button>
      {error ? <p className="pricing-card__error">{error}</p> : null}
    </article>
  );
}
