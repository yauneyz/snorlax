"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { config } from "@/lib/config";

/**
 * Variant bundles for the `hero-headline-test` PostHog experiment. Each variant is the whole
 * hero pitch — eyebrow, headline, sub copy, and CTA together — because they're written to read
 * as one cohesive pitch, not independent units that happen to sit near each other. "control"
 * must match what unauthenticated/flag-less visitors saw before this experiment existed, so a
 * failed flag fetch (ad blocker, PostHog outage) degrades to the original page rather than an
 * unproven one.
 */
const VARIANTS = {
  control: {
    eyebrow: "For people who keep overriding their blockers",
    headline: (
      <>
        A distraction blocker you need a <span>physical key</span> to turn off.
      </>
    ),
    sub: "You pair a USB drive with the app and then you can only turn off focus mode when that key is inserted. Your computer becomes a deep work sanctuary.",
    cta: "Start focusing now - free",
  },
  test: {
    eyebrow: "For people who keep overriding their blockers",
    headline: (
      <>
        Stop closing your blocker mid-impulse. <span>Require a physical key</span> instead.
      </>
    ),
    sub: "You pair a USB drive with the app and then you can only turn off focus mode when that key is inserted. Your computer becomes a deep work sanctuary.",
    cta: "Get your free key setup",
  },
} as const;

export function HeroCopy() {
  // Reads the raw posthog-js singleton rather than posthog-js/react's context hook: `Providers`
  // only mounts `<PostHogProvider>` when `config.posthog.key` is set, so the hook would throw
  // on any deployment without a PostHog key configured. This degrades to "control" instead.
  const [variantKey, setVariantKey] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!config.posthog.key) return;
    // `hero-headline-test` is created and toggled from the PostHog Experiments UI, not in code.
    return posthog.onFeatureFlags(() => {
      setVariantKey(posthog.getFeatureFlag("hero-headline-test") as string | undefined);
    });
  }, []);

  const variant = VARIANTS[variantKey === "test" ? "test" : "control"];

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
