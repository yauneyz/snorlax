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
 *
 * Lives outside HeroCopy.tsx (a "use client" module) so server code — like the dev-only
 * `/<variant-id>` preview route's generateStaticParams — can import the plain data below. A
 * client-boundary module's exports become opaque client references when imported from server
 * code, so plain consts like VARIANT_KEYS wouldn't survive that import.
 */
export const VARIANTS = {
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
    eyebrow: "",
    headline: (
      <>
        Protect your attention to you can <span>focus</span> on your work.
      </>
    ),
    sub: "Talysman is a distraction blocker you can only turn off when a physical usb key is inserted. Pair any USB drive you own and then you can only turn off focus mode when that key is inserted.",
    cta: "Start focusing in under 5 minutes - free",
  },
} as const;

export type VariantKey = keyof typeof VARIANTS;

export const VARIANT_KEYS = Object.keys(VARIANTS) as VariantKey[];

export function isVariantKey(value: string | undefined): value is VariantKey {
  return value !== undefined && value in VARIANTS;
}
