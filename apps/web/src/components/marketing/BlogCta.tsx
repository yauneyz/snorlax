"use client";
import Link from "next/link";
import { trackEvent } from "@/lib/analytics/posthog-client";

/**
 * The CTA at the bottom of every blog post. The click records which post it was on, which is
 * what files a reader who first came in through a different post under a hybrid
 * "first → this" blog channel (analytics_blog_touch, migration 0021).
 */
export function BlogCta({ slug, trialDays }: { slug: string; trialDays: number }) {
  return (
    <section className="cta-band blog-cta">
      <h2>Armor for the computer where you actually work</h2>
      <p>
        Talysman blocks distracting sites and apps on your desktop, and only a USB key you pair
        yourself can switch it off early. Put the key in another room and get back to work.
      </p>
      <Link
        href="/download"
        className="landing__cta landing__cta--primary"
        onClick={() => void trackEvent("blog_cta_clicked", { slug }, { beacon: true })}
      >
        Start focusing free
      </Link>
      <p className="cta-band__note">
        Free forever, no card. Want schedules and app blocking?{" "}
        <Link href="/pricing">Try Pro free for {trialDays} days</Link>.
      </p>
    </section>
  );
}
