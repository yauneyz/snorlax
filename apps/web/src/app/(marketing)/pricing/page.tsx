import type { Metadata } from "next";
import { FREE_BLOCKED_SITE_LIMIT } from "@talysman/product";
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
      <p className="pricing__lede">What is your time worth? Get it back with {config.app.name}</p>
      <div className="pricing__grid">
        <PricingCard
          plan="free"
          title="Free forever"
          priceLabel="$0"
          features={[
            `${FREE_BLOCKED_SITE_LIMIT} websites blocked`,
            "Unlimited websites in whitelist mode",
            "Block all internet",
            "One blocking profile",
            `Prove to yourself that ${config.app.name} works for you`,
          ]}
        />
        <PricingCard
          plan="monthly"
          title="Monthly"
          priceLabel="$10 / month"
          features={[
            "Unlimited websites blocked",
            "Unlimited blocking profiles",
            "Block apps",
            "Scheduled blocking, profile by profile",
          ]}
        />
        <PricingCard
          plan="yearly"
          title="Annual"
          priceLabel="$100 / year"
          features={[
            "Unlimited websites blocked",
            "Unlimited blocking profiles",
            "Block apps",
            "Scheduled blocking, profile by profile",
          ]}
        />
      </div>
    </section>
  );
}
