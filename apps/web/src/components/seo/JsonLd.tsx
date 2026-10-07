import {
  LIFETIME_PRICE_CENTS,
  PRO_PRICE_CENTS,
} from "@talysman/product";
import { config } from "@/lib/config";

/**
 * Structured data, rendered server-side as a JSON-LD script. Only facts that are also visible on
 * the page carrying it go in here — prices from the same constants the pricing copy uses, the
 * platforms the download page lists, the demo video the hero actually plays. No ratings: we
 * don't show any.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // `<` escaped so a string in the data can never close the script tag.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

const dollars = (cents: number) => (cents / 100).toFixed(2);

export function softwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: config.app.name,
    url: `${config.app.url}/`,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Windows 10, Windows 11, macOS, Debian, Ubuntu",
    description:
      "A website and app blocker for desktop computers. Ending a focus session early requires a paired USB key to be plugged in.",
    downloadUrl: `${config.app.url}/download`,
    offers: [
      { "@type": "Offer", name: "Free", price: "0.00", priceCurrency: "USD" },
      {
        "@type": "Offer",
        name: "Pro (monthly)",
        price: dollars(PRO_PRICE_CENTS.monthly),
        priceCurrency: "USD",
      },
      {
        "@type": "Offer",
        name: "Pro (yearly)",
        price: dollars(PRO_PRICE_CENTS.yearly),
        priceCurrency: "USD",
      },
      {
        "@type": "Offer",
        name: "Lifetime",
        price: dollars(LIFETIME_PRICE_CENTS),
        priceCurrency: "USD",
      },
    ],
  };
}

/** The hero demo on `/` — a real screen recording of the product, so it qualifies. */
export function heroVideoJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: `${config.app.name} demo: ending a focus session needs the USB key`,
    description:
      "A focus session starts, a distracting site is blocked, and turning focus off is refused until the paired USB key is plugged in.",
    thumbnailUrl: `${config.app.url}/media/hero-demo-poster.jpg`,
    contentUrl: `${config.app.url}/media/hero-demo.mp4`,
    uploadDate: "2026-08-10",
    duration: "PT28S",
  };
}

/**
 * A search page's demo video. It's a motion graphic rather than a screen recording, but every
 * frame of the app in it is the real renderer showing a recorded engine state, and the page
 * plays it — so the VideoObject describes something a visitor actually sees.
 */
export function demoVideoJsonLd(
  slug: string,
  title: string,
  video: { description: string; duration: string; uploadDate: string },
) {
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: `${config.app.name} demo: ${title}`,
    description: video.description,
    thumbnailUrl: `${config.app.url}/media/demos/${slug}.jpg`,
    contentUrl: `${config.app.url}/media/demos/${slug}.mp4`,
    embedUrl: `${config.app.url}/${slug}#demo`,
    uploadDate: video.uploadDate,
    duration: video.duration,
  };
}
