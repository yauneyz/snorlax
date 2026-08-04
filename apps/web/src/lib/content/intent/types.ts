import type { ReactNode } from "react";

/**
 * High-intent search pages.
 *
 * Each page answers exactly one query a person actually types — "website blocker you can't
 * disable", "Cold Turkey alternative", "turn a USB drive into a distraction blocker" — and is
 * built from the block types below rather than hand-written markup, so the nine pages share one
 * template and one set of styles.
 *
 * Two rules hold across all of them:
 *
 *  1. The intent is answered in the first paragraph, before any pitch. Someone who bounces after
 *     ten seconds should still leave with the answer.
 *  2. Every page carries a demonstration — the specific moment where the mechanism is felt, told
 *     beat by beat. Until the footage exists the beats carry the page on their own; the media
 *     slot beside them reserves the space so dropping the file in later reflows nothing.
 */

/** A shot list for artwork that doesn't exist yet. Mirrors `MediaPlaceholder`'s props. */
export type IntentMedia = {
  label: string;
  note: string;
  /** Width/height of the eventual asset, e.g. "16 / 9". */
  ratio: string;
  kind: string;
};

export type IntentSection =
  /** Running prose. For the parts that need to argue rather than enumerate. */
  | { kind: "prose"; id?: string; title: string; lede?: string; body: ReactNode }
  /**
   * The demonstration. `beats` is the sequence as it happens on screen — write them so the
   * section reads as a demo with the video muted, because for now it is one.
   */
  | {
      kind: "demo";
      id?: string;
      title: string;
      lede?: string;
      beats: { label: string; body: string }[];
      outcome?: ReactNode;
      media: IntentMedia;
    }
  /**
   * A comparison grid. Used for competitor pages and for "here is every way out and what it
   * costs you" tables. `highlightLast` lights the final column, which is always ours.
   */
  | {
      kind: "table";
      id?: string;
      title: string;
      lede?: string;
      caption?: string;
      columns: string[];
      rows: string[][];
      highlightLast?: boolean;
      footnote?: ReactNode;
    }
  /** Numbered instructions. */
  | {
      kind: "steps";
      id?: string;
      title: string;
      lede?: string;
      steps: { title: string; body: ReactNode }[];
    }
  /** A grid of short claims, each stated as the outcome rather than the mechanism. */
  | {
      kind: "cards";
      id?: string;
      title: string;
      lede?: string;
      cards: { title: string; body: ReactNode }[];
    }
  /**
   * The limits of the claim, stated plainly. Every page that promises something hard to
   * escape carries one of these — overselling enforcement is how a blocker loses trust.
   */
  | { kind: "honesty"; id?: string; title: string; body: ReactNode }
  | { kind: "faq"; id?: string; title?: string; items: { q: string; a: ReactNode }[] };

export type IntentPage = {
  /** URL segment, served at the site root: `/website-blocker-you-cant-disable`. */
  slug: string;
  /** The query this page exists to answer. Documentation, not rendered. */
  intent: string;
  eyebrow: string;
  /** The h1. Should contain the query nearly verbatim without reading like it does. */
  title: string;
  /** `<title>`. Absolute — the root layout's brand template is not applied. */
  metaTitle: string;
  metaDescription: string;
  lede: ReactNode;
  /** The direct answer, above everything else. Two short paragraphs at most. */
  answer: ReactNode;
  sections: IntentSection[];
  cta?: { heading: string; body: string };
  /** Slugs of sibling pages. Keeps the set crawlable from any one of its members. */
  related: string[];
};
