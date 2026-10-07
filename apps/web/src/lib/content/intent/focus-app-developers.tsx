import Link from "next/link";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * Persona page for programmers. The hard case is that the distractions are also the references
 * — YouTube tutorials, Reddit threads, Hacker News — so the recipe uses site rules (feed off,
 * direct links on) rather than blanket blocks, and is explicit that dev tools keep working.
 */
export const focusAppDevelopers: IntentPage = {
  slug: "focus-app-developers",
  group: "use-cases",
  summary: "Block the feeds on YouTube, Reddit and Hacker News while coding, and keep docs and tutorials.",
  lastReviewed: "2026-10-07",
  intent:
    "focus app for developers / best distraction blocker for programmers who need youtube for work",
  eyebrow: "Focus app for developers",
  title: "Focus app for developers: block distractions while coding",
  metaTitle: "Focus App for Developers: Block Distractions While Coding",
  metaDescription:
    "Protect coding sessions from Reddit, YouTube, Discord and other distractions while keeping your development tools available.",
  lede: <>Your distractions are also your documentation. The blocker has to know the difference.</>,
  answer: (
    <>
      <p>
        For programmers who need YouTube and Reddit for work but get distracted by them, the best
        setup hides the feeds and keeps direct links: tutorials and threads you search for still
        open, the homepage and recommendations don&apos;t. {config.app.name} does this with site
        rules for YouTube, Reddit and Hacker News, blocks Discord and games as apps, and leaves your
        editor, terminal and package registries alone.
      </p>
      <p>
        Ending a coding session early requires a paired USB key plugged in. It runs on Windows,
        macOS and Debian/Ubuntu Linux.
      </p>
    </>
  ),
  sections: [
    {
      kind: "table",
      title: "A setup recipe for coding sessions",
      columns: ["Site or app", "Setting", "Why"],
      rows: [
        ["YouTube", "Site rule: feed, sidebar, recommendations hidden", "Tutorials you search for still play"],
        ["Reddit", "Site rule: feeds hidden", "Threads from search still open"],
        ["Hacker News", "Site rule", "Links you follow work; the front page doesn't pull you in"],
        ["X, Instagram, TikTok", "Block", "Rarely needed while coding"],
        ["Discord, Slack, Steam", "Block as apps (Pro)", "The distraction that isn't a tab"],
        ["Editor, terminal, GitHub, docs, registries", "Leave alone", "A blocklist only blocks what's on it"],
      ],
    },
    {
      kind: "demo",
      title: "A coding session",
      beats: [
        { label: "Stuck", body: "A borrow-checker error. You search YouTube, open the explainer, and it plays with no sidebar." },
        { label: "Drift", body: "The video ends. You click the YouTube logo. No feed. You open Reddit — no front page." },
        { label: "The off switch", body: "You open Talysman. “Insert your key to turn off the blocker.” The key is in your bag by the door." },
        { label: "Fixed", body: "You go back and fix the lifetime." },
      ],
      media: {
        label: "A coding session with site rules on",
        note: "Screen recording: editor → YouTube search → video with no sidebar → empty YouTube home → Reddit with no feed → refusal dialog.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "faq",
      items: [
        {
          q: "Will it break localhost, Docker or package installs?",
          a: <p>No. A blocklist only blocks the domains and apps you put on it. Allow-only mode is the one setting to configure carefully.</p>,
        },
        {
          q: "Does it work on Linux?",
          a: <p>Yes, Debian and Ubuntu. See <Link href="/website-blocker-linux">the Linux page</Link>.</p>,
        },
        {
          q: "Can I tune what YouTube hides?",
          a: <p>Yes. Each part of the site rule (Shorts, comments, end screens and more) is its own switch. See <Link href="/block-youtube-while-working">blocking YouTube while working</Link>.</p>,
        },
      ],
    },
  ],
  cta: { heading: "Keep the docs, lose the feeds", body: "Pair a drive, add the site rules, and put the key out of reach." },
  graphic: {
    kind: "compare",
    title: "A coding-session blocklist that leaves your tools alone",
    caption: "A Talysman setup for programmers: which sites get site rules, which get blocked, and what to leave alone.",
    fromTable: "A setup recipe for coding sessions",
    rows: [
      "YouTube",
      "Reddit",
      "Hacker News",
      "X, Instagram, TikTok",
      "Discord, Slack, Steam",
      "Editor, terminal, GitHub, docs, registries",
    ],
  },
  related: ["block-youtube-while-working", "block-reddit-while-working", "website-blocker-linux", "deep-work-blocker"],
};
