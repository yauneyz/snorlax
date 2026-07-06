import type { Metadata } from "next";
import { PricingCard } from "@/components/marketing/PricingCard";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Simple pricing for ${config.app.name}.`,
  alternates: { canonical: `${config.app.url}/pricing` },
};

export default function PricingPage() {
  return (
    <section className="pricing">
      <h1>Pricing</h1>
      <p className="pricing__lede">One plan. Pick monthly or save with yearly.</p>
      <div className="pricing__grid">
        <PricingCard
          plan="monthly"
          title="Monthly"
          priceLabel="$10 / month"
          features={["Full access", "Cancel anytime", "Standard support"]}
        />
        <PricingCard
          plan="yearly"
          title="Yearly"
          priceLabel="$100 / year"
          features={["Full access", "Two months free", "Priority support"]}
        />
      </div>
    </section>
  );
}
