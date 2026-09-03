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
 *
 * Each test variant gets its own key, never reused for different copy. PostHog buckets and
 * reports by variant key, so editing an existing variant's copy in place would silently blend
 * pre- and post-edit traffic into one number — neither trustworthy. To try new copy, add a new
 * key below (`test-b`, `test-c`, ...) and create a matching variant in the PostHog experiment
 * (or a fresh experiment/flag if the old one already concluded). Retire a variant by deleting
 * its entry here once its flag/experiment is gone — VariantKey then stops accepting it, so any
 * leftover reference is a compile error, not a silent fallback to "control".
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
  // Added 2026-09-02.
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

type VariantKey = keyof typeof VARIANTS;

function isVariantKey(value: string | undefined): value is VariantKey {
  return value !== undefined && value in VARIANTS;
}

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

  // Falls back to "control" for undefined (flag not loaded/configured) *and* for a flag value
  // that names a variant no longer in VARIANTS (e.g. a retired one still assigned in PostHog) —
  // never lets an unrecognized key reach the lookup below.
  const variant = VARIANTS[isVariantKey(variantKey) ? variantKey : "control"];

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
