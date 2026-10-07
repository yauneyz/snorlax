import Link from "next/link";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * Persona page for writers. Writers rarely need the web mid-draft, so the recommended setup is
 * the strict one — allow-only, or a hard block of their particular sites — and the key carries
 * the rest. The FAQ handles the research problem honestly: do it before the session.
 */
export const focusAppWriters: IntentPage = {
  slug: "focus-app-writers",
  group: "use-cases",
  summary: "A writing session where Reddit and the rest stay blocked until you go and fetch your key.",
  lastReviewed: "2026-10-07",
  intent: "focus app for writers / best focus software for a writer who keeps opening reddit",
  eyebrow: "Focus app for writers",
  title: "Focus app for writers: protect your writing sessions",
  metaTitle: "Focus App for Writers: Protect Your Writing Sessions",
  metaDescription:
    "Create a writing environment where distracting sites and apps stay blocked until you deliberately retrieve your key.",
  lede: <>The sentence gets hard, and your hand is already on the trackpad heading for Reddit.</>,
  answer: (
    <>
      <p>
        The best focus software for a writer who keeps opening Reddit is one that blocks it for the
        whole session and can&apos;t be switched off from the writing desk. {config.app.name} blocks
        the sites and apps you drift to on Windows, macOS and Linux, and ending a session early
        needs a paired USB key — which you leave in another room before you start.
      </p>
    </>
  ),
  sections: [
    {
      kind: "steps",
      title: "A writing-session setup",
      steps: [
        { title: "Do research first", body: "Collect sources before the session. Writing time is for writing." },
        { title: "Block your three sites", body: "Reddit, the news, whatever yours is. Or use allow-only mode: everything blocked except the reference site you need." },
        { title: "Pick a length you'll keep", body: "Ninety minutes is a good start. Schedule it for the same time each day with Pro." },
        { title: "Leave the key somewhere else", body: "The kitchen, the car. You want getting out to take a walk." },
      ],
    },
    {
      kind: "demo",
      title: "The stuck paragraph",
      beats: [
        { label: "Stuck", body: "Third rewrite of the same paragraph. You open a tab." },
        { label: "Blocked", body: "Reddit's block page. You open Talysman to end the session." },
        { label: "The key", body: "“Insert your key to turn off the blocker.” It's in the kitchen." },
        { label: "Unstuck", body: "Not worth the walk. You stare at the paragraph instead, and then you fix it." },
      ],
      media: {
        label: "A writing session interrupted, briefly",
        note: "Screen recording: writing app → Reddit block page → refusal dialog → back to the document.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "faq",
      items: [
        { q: "What if I need to look something up?", a: <p>Note it and look it up after the session, or allow the one reference site you need.</p> },
        { q: "Does it block Reddit in every browser?", a: <p>Yes, at the network level. See <Link href="/block-reddit-while-working">blocking Reddit while working</Link>.</p> },
        { q: "Will it work with Scrivener, Word or Obsidian?", a: <p>Yes. Apps are only blocked if you add them to the list.</p> },
      ],
    },
  ],
  cta: { heading: "Write the next chapter with the key in the kitchen", body: "Free with any USB drive. No card." },
  graphic: {
    kind: "timeline",
    title: "A 90-minute writing session",
    caption: "An example ninety-minute Talysman writing session: the stuck paragraph, the blocked tab, the key in the kitchen, and the session ending on its own.",
    from: 8.75,
    to: 10.75,
    window: { from: 9, to: 10.5, label: "Writing session · 90 minutes" },
    events: [
      { at: 9, label: "Session starts, three sites blocked", tone: "open" },
      { at: 9.58, label: "Third rewrite. A tab: block page", tone: "blocked" },
      { at: 9.6, label: "Turn off? The key is in the kitchen", tone: "blocked" },
      { at: 10.5, label: "Session ends. Chapter moved", tone: "open" },
    ],
  },
  related: ["block-reddit-while-working", "deep-work-blocker", "website-blocker-mac", "stop-disabling-website-blocker"],
};
