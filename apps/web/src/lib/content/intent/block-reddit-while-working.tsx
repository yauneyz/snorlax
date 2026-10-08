import Link from "next/link";
import { FREE_BLOCKED_SITE_LIMIT } from "@talysman/product";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * Tactical how-to. Reddit is the rare distraction that is also a reference library — the
 * search result that answers your bug is a Reddit thread — so the page offers the feed-only
 * block first and the full block second, and says which person each one is for.
 */
export const blockRedditWhileWorking: IntentPage = {
  slug: "block-reddit-while-working",
  group: "guides",
  summary: "Block Reddit's feeds during work on Windows, Mac or Linux, and keep the threads you search for.",
  lastReviewed: "2026-10-07",
  intent: "block reddit while working / focus software for a writer who keeps opening reddit",
  eyebrow: "Block Reddit while working",
  title: "How to block Reddit while working on your computer",
  metaTitle: "How to Block Reddit While Working on Your Computer",
  metaDescription:
    "Block Reddit during focused work on Windows, Mac or Linux and make impulsive unblocking harder.",
  lede: (
    <>
      You don&apos;t open Reddit to read Reddit. You open it because your hands know the way there
      faster than you can decide not to.
    </>
  ),
  answer: (
    <>
      <p>
        To block Reddit while working, add it to a desktop blocker that enforces below the browser,
        and make ending the block early cost more than the impulse. {config.app.name} can block
        reddit.com outright, or hide just the front page, subreddit feeds and recommendations while
        keeping posts you open from search — and ending a session early needs a paired USB key
        plugged in.
      </p>
      <p>It works on Windows, macOS and Linux, with extensions for Chrome and Firefox.</p>
    </>
  ),
  sections: [
    {
      kind: "table",
      title: "Block all of Reddit, or just the feed",
      columns: ["", "Reddit site rule", "Full block"],
      rows: [
        ["Front page and subreddit feeds", "Hidden", "Blocked"],
        ["Recommendations and related posts", "Hidden", "Blocked"],
        ["User profiles", "Hidden", "Blocked"],
        ["A thread you open from Google", "Opens", "Blocked"],
        ["Search, messages, notifications, posting", "Work", "Blocked"],
        ["Best for", "Developers and anyone who finds answers on Reddit", "Writers and anyone who doesn't need it during work"],
      ],
      footnote: (
        <>
          Either one counts as one of the {FREE_BLOCKED_SITE_LIMIT} free websites. Site rules need
          the Chrome or Firefox extension, so Strict Mode stays on while one is active.
        </>
      ),
    },
    {
      kind: "steps",
      title: "Block Reddit in three steps",
      steps: [
        {
          title: "Install and pair any USB drive",
          body: (
            <>
              <Link href="/download?from=block-reddit-while-working">Download {config.app.name}</Link>, add the browser extension,
              and pair a drive you already own as the key.
            </>
          ),
        },
        {
          title: "Add Reddit",
          body: "Pick the Reddit site rule to keep threads you search for, or block reddit.com entirely. It covers old.reddit.com and redd.it links too, not just one address.",
        },
        {
          title: "Start a session and unplug the key",
          body: "Put the drive somewhere that costs a walk. That's what turns “just checking” into a decision.",
        },
      ],
    },
    {
      kind: "demo",
      title: "What happens when you reach for it",
      beats: [
        {
          label: "Muscle memory",
          body: "Ctrl+T, “r”, Enter. The front page loads with no posts on it.",
        },
        {
          label: "The workaround",
          body: "You try the Reddit app, or another browser. Blocking runs below the browser, and with Strict Mode on a browser without the extension is closed.",
        },
        {
          label: "The off switch",
          body: "You open Talysman to end the session. “Insert your key to turn off the blocker.” The key is in your bag in the hall.",
        },
        {
          label: "Back to work",
          body: "The impulse is gone before you'd reach the hall. You close the tab.",
        },
      ],
      media: {
        label: "Reddit with the feed hidden, then the failed unblock",
        note: "Screen recording: reddit.com with the feed removed → Talysman End session → refusal dialog → cut to the key in another room.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "faq",
      items: [
        {
          q: "Can I still read a Reddit thread I found on Google?",
          a: <p>With the Reddit site rule, yes. Posts you open directly load; feeds don&apos;t.</p>,
        },
        {
          q: "What's the best focus software for a writer who keeps opening Reddit?",
          a: (
            <p>
              Block reddit.com outright during writing sessions and keep the key in another room.
              Writers rarely need Reddit mid-draft, so the full block is simpler. More in{" "}
              <Link href="/focus-app-writers">the writers page</Link>.
            </p>
          ),
        },
        {
          q: "Does it block the Reddit desktop app or other browsers?",
          a: (
            <p>
              Network-level blocking covers every browser. Desktop apps can be blocked with Pro.
              With Strict Mode on, browsers without the extension are closed during focus.
            </p>
          ),
        },
      ],
    },
  ],
  cta: {
    heading: "Keep the answers, lose the feed",
    body: "Pair a drive, add the Reddit rule, and leave the key somewhere inconvenient.",
  },
  graphic: {
    kind: "compare",
    title: "Reddit while working: the feed, or the whole site",
    caption: "What Talysman's Reddit site rule hides and keeps, next to blocking Reddit outright.",
    fromTable: "Block all of Reddit, or just the feed",
    rows: [
      "Front page and subreddit feeds",
      "Recommendations and related posts",
      "A thread you open from Google",
      "Search, messages, notifications, posting",
      "Best for",
    ],
  },
  related: [
    "block-social-media-on-computer",
    "block-youtube-while-working",
    "focus-app-writers",
    "focus-app-developers",
  ],
};
