"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { config } from "@/lib/config";
import { isVariantKey, VARIANTS, type VariantKey } from "@/components/marketing/heroVariants";

export function HeroCopy({ forceVariant }: { forceVariant?: VariantKey } = {}) {
  // Reads the raw posthog-js singleton rather than posthog-js/react's context hook: `Providers`
  // only mounts `<PostHogProvider>` when `config.posthog.key` is set, so the hook would throw
  // on any deployment without a PostHog key configured. This degrades to "control" instead.
  const [variantKey, setVariantKey] = useState<string | undefined>(undefined);

  useEffect(() => {
    // Experiment temporarily disabled: always show the "control" variant.
    return;
  }, [forceVariant]);

  // Falls back to "control" for undefined (flag not loaded/configured) *and* for a flag value
  // that names a variant no longer in VARIANTS (e.g. a retired one still assigned in PostHog) —
  // never lets an unrecognized key reach the lookup below.
  const variant = VARIANTS[forceVariant ?? (isVariantKey(variantKey) ? variantKey : "control")];

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
