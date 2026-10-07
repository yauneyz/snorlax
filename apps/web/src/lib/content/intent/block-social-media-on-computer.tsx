import Link from "next/link";
import { FREE_BLOCKED_SITE_LIMIT, PRO_TRIAL_DAYS } from "@talysman/product";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * A checklist-shaped how-to. Most people searching this still need some of social media for
 * work — LinkedIn messages, a client's DM, posting for a job — so the page splits "block it" from
 * "remove the feed" and gives the site-rule list, then the commitment step that makes both hold.
 */
export const blockSocialMediaOnComputer: IntentPage = {
  slug: "block-social-media-on-computer",
  group: "guides",
  summary: "A checklist for blocking social media during work, with or without the feeds.",
  lastReviewed: "2026-10-07",
  intent: "block social media on computer during work",
  eyebrow: "Block social media on your computer",
  title: "How to block social media on your computer during work",
  metaTitle: "How to Block Social Media on Your Computer During Work",
  metaDescription:
    "Block distracting social sites during focused desktop work and add friction before you change your mind.",
  lede: (
    <>
      Blocking social media takes a minute. Keeping it blocked at 3pm is the part this checklist is
      for.
    </>
  ),
  answer: (
    <>
      <p>
        To block social media on your computer during work: list the sites that actually take your
        time, decide which ones you need for work, block the rest outright and remove only the feeds
        from the ones you need, then make ending the block early inconvenient.{" "}
        {config.app.name} does all four on Windows, macOS and Linux, and ending a session early
        requires a paired USB key plugged in.
      </p>
    </>
  ),
  sections: [
    {
      kind: "steps",
      title: "The checklist",
      steps: [
        {
          title: "Write down your actual list",
          body: "Not every site — the three to five you open without deciding to. That's usually the whole problem, and it fits in the free tier.",
        },
        {
          title: "Split it: need for work vs don't",
          body: "LinkedIn messages for recruiting, X for a launch, Instagram DMs for a client. Those get a site rule. The rest get blocked.",
        },
        {
          title: "Block the don't-needs outright",
          body: "Domain-level, enforced below the browser, so a different browser isn't a way around it.",
        },
        {
          title: "Remove the feed from the need-to-haves",
          body: "Site rules hide the feed, recommendations, stories and profiles while keeping search, messages, posting and things you open directly.",
        },
        {
          title: "Put the off switch somewhere else",
          body: (
            <>
              Pair a USB drive as the key, start a session, and leave the drive in another room.
              This is the step that decides whether the first four survive the afternoon.{" "}
              <Link href="/physical-website-blocker">How the key works</Link>.
            </>
          ),
        },
        {
          title: "Schedule it",
          body: `With Pro, recurring windows start the block without you — even if the app is closed. Free for ${PRO_TRIAL_DAYS} days.`,
        },
      ],
    },
    {
      kind: "table",
      title: "Sites with feed-only rules",
      lede: "Everything else can still be blocked outright. These can also be kept, minus the parts built to keep you scrolling.",
      columns: ["Site", "Hidden by default", "Still works"],
      rows: [
        ["Reddit", "Feeds, recommendations, profiles", "Posts you open, search, messages, posting"],
        ["YouTube", "Home feed, sidebar, recommendations, end screens", "Search, videos you open, Studio"],
        ["X", "Home timeline, Explore, trends, profiles", "Posts you open, search, messages, posting"],
        ["Instagram", "Home feed, Explore and Reels tab, stories", "Posts you open, search, DMs, posting"],
        ["Facebook", "News feed, reels, stories, suggestions", "Messages, groups, Marketplace, events"],
        ["LinkedIn", "Feed, recommendations, jobs", "Messaging, search, posting, notifications"],
        ["TikTok", "For You, Following, Explore", "Videos you open, search, messages, uploading"],
      ],
      footnote: (
        <>
          Threads, Bluesky, Pinterest, Hacker News, Substack and a few news sites have rules too.
          Each rule counts as one of the {FREE_BLOCKED_SITE_LIMIT} free websites and needs the Chrome
          or Firefox extension.
        </>
      ),
    },
    {
      kind: "demo",
      title: "A work session with social media half-on",
      beats: [
        {
          label: "9:00",
          body: "Session starts on schedule. X, Instagram and TikTok are blocked. LinkedIn has no feed.",
        },
        {
          label: "10:40",
          body: "A recruiter messages. You open LinkedIn, reply, and there's nothing else on the page to read.",
        },
        {
          label: "14:15",
          body: "Slump. You open Talysman to end the session early. “Insert your key to turn off the blocker.” The key is in the car.",
        },
        {
          label: "14:16",
          body: "You get a coffee instead and come back to the task.",
        },
      ],
      media: {
        label: "LinkedIn with no feed, and the refusal dialog",
        note: "Screen recording: LinkedIn messaging works, feed is gone → Talysman End session → refusal → cut to key in another room.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "faq",
      items: [
        {
          q: "Will this block social media on my phone?",
          a: (
            <p>
              No. {config.app.name} is desktop-only. If your phone is the bigger problem, pair it
              with a phone blocker — see the <Link href="/brick-for-computer">Brick comparison</Link>.
            </p>
          ),
        },
        {
          q: "Does the extension see what I browse?",
          a: (
            <p>
              No. Your list becomes browser-native rules; the extension never receives your URLs,
              history or page content.
            </p>
          ),
        },
      ],
    },
  ],
  cta: {
    heading: "Block the feeds, keep the messages",
    body: `Free for your worst ${FREE_BLOCKED_SITE_LIMIT} sites. Pair a drive and put it in another room.`,
  },
  graphic: {
    kind: "rules",
    title: "Social media without the feed",
    caption: "For seven sites, what Talysman's site rules hide by default and what keeps working.",
    fromTable: "Sites with feed-only rules",
    rows: [
      "Reddit",
      "YouTube",
      "X",
      "Instagram",
      "Facebook",
      "LinkedIn",
      "TikTok",
    ],
  },
  related: [
    "block-reddit-while-working",
    "block-youtube-while-working",
    "focus-app-remote-work",
    "stop-disabling-website-blocker",
  ],
};
