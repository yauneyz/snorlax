"use client";
import Link from "next/link";
import { VARIANTS, type VariantKey } from "@/components/marketing/heroVariants";

export function HeroCopy({ forceVariant }: { forceVariant?: VariantKey } = {}) {
  // Experiment temporarily disabled: always show the "control" variant.
  const variant = VARIANTS[forceVariant ?? "control"];

  return (
    <>
      <p className="hero__eyebrow">{variant.eyebrow}</p>
      <h1 className="hero__headline">{variant.headline}</h1>
      <div className="hero__sub">
        <p>{variant.sub}</p>
      </div>
      <div className="hero__ctas">
        <Link href="/download" className="landing__cta landing__cta--primary">
          {variant.cta}
        </Link>
        <Link href="#how" className="landing__cta landing__cta--secondary">
          See how it works
        </Link>
      </div>
    </>
  );
}
