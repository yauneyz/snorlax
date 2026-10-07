// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LIFETIME_PRICE_CENTS, PRO_PRICE_CENTS } from "@talysman/product";
import { intentPages, getIntentPage, relatedIntentPages } from "@/lib/content/intent";
import { LEGACY_INTENT_REDIRECTS } from "@/lib/content/intent/legacy-redirects";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { softwareApplicationJsonLd } from "@/components/seo/JsonLd";
import { demoVideo } from "@/lib/content/intent/videos";
import { graphicSize } from "@/lib/og/intentGraphic";

// Static segments under (marketing) that a root-level slug must never shadow or collide with.
const RESERVED = ["about", "blog", "download", "pricing", "privacy", "terms", "login", "signup", "app", "account", "api"];

describe("intent pages", () => {
  it("have unique slugs, titles, h1s and descriptions", () => {
    for (const key of ["slug", "title", "metaTitle", "metaDescription"] as const) {
      const values = intentPages.map((page) => page[key]);
      expect(new Set(values).size, key).toBe(values.length);
    }
  });

  it("don't collide with real routes", () => {
    for (const page of intentPages) expect(RESERVED).not.toContain(page.slug);
  });

  it("only link to pages that exist", () => {
    for (const page of intentPages) {
      expect(relatedIntentPages(page).length, page.slug).toBe(page.related.length);
    }
  });

  it("redirect every renamed slug to a live page, and never from a live one", () => {
    for (const [from, to] of Object.entries(LEGACY_INTENT_REDIRECTS)) {
      expect(getIntentPage(to), to).not.toBeNull();
      expect(getIntentPage(from), from).toBeNull();
    }
  });

  it("date their claims", () => {
    for (const page of intentPages) expect(page.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // The homepage used to say "every other blocker → click End session", which is false for
  // Cold Turkey, Freedom and FocusMe. Keep that framing out of the search pages too.
  it("don't claim every other blocker is one click", () => {
    for (const page of intentPages) {
      const text = renderToStaticMarkup(<>{page.answer}{page.lede}</>);
      expect(text, page.slug).not.toMatch(/every other blocker/i);
    }
  });
});

describe("intent page media", () => {
  it("each have a demo section", () => {
    for (const page of intentPages) {
      expect(page.sections.some((section) => section.kind === "demo"), page.slug).toBe(true);
    }
  });

  // graphicSize lays the graphic out, which resolves every `fromTable` row it names — a renamed
  // table or reworded row label fails here rather than at build.
  it("each have a graphic built from rows that exist", () => {
    for (const page of intentPages) expect(() => graphicSize(page), page.slug).not.toThrow();
  });

  // Rendered by apps/motion (`pnpm --filter @talysman/motion render <slug>`).
  it("each have a rendered demo video", () => {
    for (const page of intentPages) {
      expect(demoVideo(page.slug), page.slug).not.toBeNull();
      for (const ext of ["mp4", "webm", "jpg"]) {
        const file = resolve(__dirname, `../../public/media/demos/${page.slug}.${ext}`);
        expect(existsSync(file), file).toBe(true);
      }
    }
  });
});

describe("SoftwareApplication JSON-LD", () => {
  it("quotes the same prices as the product constants", () => {
    const prices = softwareApplicationJsonLd().offers.map((offer) => offer.price);
    expect(prices).toEqual([
      "0.00",
      (PRO_PRICE_CENTS.monthly / 100).toFixed(2),
      (PRO_PRICE_CENTS.yearly / 100).toFixed(2),
      (LIFETIME_PRICE_CENTS / 100).toFixed(2),
    ]);
  });
});
