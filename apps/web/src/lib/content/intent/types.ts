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
  | { kind: "prose"; id?: string; title: string; lede?: string; body: React.ReactNode }
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
      outcome?: React.ReactNode;
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
      footnote?: React.ReactNode;
    }
  /** Numbered instructions. */
  | {
      kind: "steps";
      id?: string;
      title: string;
      lede?: string;
      steps: { title: string; body: React.ReactNode }[];
    }
  /** A grid of short claims, each stated as the outcome rather than the mechanism. */
  | {
      kind: "cards";
      id?: string;
      title: string;
      lede?: string;
      cards: { title: string; body: React.ReactNode }[];
    }
  /**
   * The limits of the claim, stated plainly. Every page that promises something hard to
   * escape carries one of these — overselling enforcement is how a blocker loses trust.
   */
  | { kind: "honesty"; id?: string; title: string; body: React.ReactNode }
  | { kind: "faq"; id?: string; title?: string; items: { q: string; a: React.ReactNode }[] };

/**
 * The page's infographic (rendered by Satori at build time, served at `/<slug>/graphic.png`):
 * the answer drawn as something you can take in at a glance. Facts that the page already states
 * in a table are referenced by row label (`fromTable`) rather than restated, so the picture can't
 * drift from the copy.
 */
export type GraphicTone = "blocked" | "open" | "cost" | "plain";

export type IntentGraphic = {
  /** The headline drawn on the image. */
  title: string;
  /** Shown under the image, and the start of its alt text. */
  caption: string;
} & (
  | {
      /** Every way out and where it lands — the page table's rows, each marked. */
      kind: "ladder";
      fromTable: string;
      rows: Record<string, GraphicTone>;
    }
  | {
      /** Products side by side: chosen rows of the page's comparison table. */
      kind: "compare";
      fromTable: string;
      rows: string[];
    }
  | {
      /** Per site: what a site rule hides and what keeps working (site | hidden | works rows). */
      kind: "rules";
      fromTable: string;
      rows: string[];
    }
  | {
      /** A day, hour by hour: the protected window and what happens in it. */
      kind: "timeline";
      /** Hours, 24h. */
      from: number;
      to: number;
      window: { from: number; to: number; label: string };
      events: { at: number; label: string; tone: GraphicTone }[];
    }
  | {
      /** A sequence of states, left to right — the key's lifecycle, say. */
      kind: "states";
      states: { label: string; text: string; tone: GraphicTone }[];
      notes?: string[];
    }
);

/**
 * Which footer column a page is listed under. Grouping only — every page is served at the site
 * root (`/cold-turkey-alternative`), because the query is the URL.
 */
export type IntentGroup = "compare" | "guides" | "use-cases";

export type IntentPage = {
  /** URL segment, served at the site root: `/website-blocker-you-cant-turn-off`. */
  slug: string;
  group: IntentGroup;
  /** One line for related-page cards. Says what the page answers, not what it sells. */
  summary: string;
  /**
   * ISO date the page's claims were last checked. Feeds the sitemap's lastModified, and on
   * pages that describe other products it is shown as "Last checked" so a reader (or a model)
   * can judge how fresh the comparison is.
   */
  lastReviewed: string;
  /** Show `lastReviewed` on the page. Set on anything that makes claims about competitors. */
  showLastReviewed?: boolean;
  /** The query this page exists to answer. Documentation, not rendered. */
  intent: string;
  eyebrow: string;
  /** The h1. Should contain the query nearly verbatim without reading like it does. */
  title: string;
  /** `<title>`. Absolute — the root layout's brand template is not applied. */
  metaTitle: string;
  metaDescription: string;
  lede: React.ReactNode;
  /** The direct answer, above everything else. Two short paragraphs at most. */
  answer: React.ReactNode;
  sections: IntentSection[];
  cta?: { heading: string; body: string };
  graphic: IntentGraphic;
  /** Slugs of sibling pages. Keeps the set crawlable from any one of its members. */
  related: string[];
};
