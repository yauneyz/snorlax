import Link from "next/link";
import { FREE_BLOCKED_SITE_LIMIT, PRO_TRIAL_DAYS } from "@talysman/product";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * Practical intent — "block YouTube while working" — with the qualifier that decides everything:
 * "without losing work access". Most people searching this need YouTube for tutorials, talks or
 * their own channel. So the page leads with the two settings (hide the feed, or block it outright)
 * and only then gets to the key, because the key is what makes either setting hold.
 */
export const blockYoutubeWhileWorking: IntentPage = {
  slug: "block-youtube-while-working",
  group: "guides",
  summary: "Hide YouTube's feed and recommendations during work, and keep search and direct links.",
  lastReviewed: "2026-10-07",
  intent:
    "block youtube while working / distraction blocker for programmers who need youtube for work",
  eyebrow: "Block YouTube while working",
  title: "How to block YouTube while working without losing work access",
  metaTitle: "How to Block YouTube While Working Without Losing Work Access",
  metaDescription:
    "Create focused YouTube rules for work sessions and reduce the temptation to switch from useful videos to distraction.",
  lede: (
    <>
      The tutorial isn&apos;t the problem. The sidebar next to it is, and the homepage you land on
      when the tutorial ends.
    </>
  ),
  answer: (
    <>
      <p>
        To block YouTube while working without losing work access, block the parts that pull you
        away — the home feed, recommendations, the sidebar, end screens — and keep search and the
        videos you open directly. {config.app.name}&apos;s YouTube site rule does exactly that in
        Chrome and Firefox on Windows, macOS and Linux. If you don&apos;t need YouTube for work at
        all, block the whole domain instead.
      </p>
      <p>
        Either setting holds for the same reason: ending a focus session early requires a paired USB
        drive to be plugged into the computer. Leave the drive in another room and the rule stays
        in place until the session ends, not until you change your mind.
      </p>
    </>
  ),
  sections: [
    {
      kind: "table",
      title: "Two ways to block YouTube",
      lede: "Pick by whether YouTube is part of your job.",
      columns: ["", "Site rule (keep work access)", "Full block"],
      rows: [
        ["Search", "Works", "Blocked"],
        ["Videos you open from a link or search", "Play normally", "Blocked"],
        ["Home feed", "Hidden", "Blocked"],
        ["Recommendations, sidebar, end screens", "Hidden", "Blocked"],
        ["Shorts", "Your choice, per rule", "Blocked"],
        ["YouTube Studio and uploads", "Work", "Blocked"],
        ["Best for", "Programmers, students, creators — anyone who learns from video", "Everyone else"],
      ],
      footnote: (
        <>
          A site rule counts as one of the {FREE_BLOCKED_SITE_LIMIT} websites on the free plan. It
          needs the Chrome or Firefox extension, so while a site rule is active, Strict Mode stays on
          and browsers without the extension are closed during focus.
        </>
      ),
    },
    {
      kind: "steps",
      title: "Set it up in about two minutes",
      steps: [
        {
          title: "Install and pair a drive",
          body: (
            <>
              <Link href="/download">Download {config.app.name}</Link> for your platform and add the
              Chrome or Firefox extension. Plug in any USB drive you own and pair it — that drive is
              now the key for this computer.
            </>
          ),
        },
        {
          title: "Add YouTube as a site rule, or block it",
          body: (
            <>
              Add YouTube from the site list and keep the defaults (feed, recommendations, sidebar
              and end screens hidden; search and direct videos allowed), or block youtube.com
              outright. Add whatever replaces it later in the afternoon — Reddit and X have site
              rules too.
            </>
          ),
        },
        {
          title: "Start a session, then unplug the key",
          body: (
            <>
              Set a length and start. Take the drive out of the machine and leave it somewhere that
              costs you a walk. That step is not optional; it&apos;s the entire mechanism.
            </>
          ),
        },
      ],
    },
    {
      kind: "demo",
      title: "What a work session on YouTube looks like",
      lede: "The useful video plays. Everything designed to keep you watching doesn't load.",
      beats: [
        {
          label: "Search",
          body: "You search “rust lifetimes explained”. Results load. You open the one you wanted.",
        },
        {
          label: "The video",
          body: "It plays. No sidebar of related videos, no comments rabbit hole if you turned them off, no autoplay wall at the end.",
        },
        {
          label: "The homepage",
          body: "When the video ends you click the logo out of habit. The feed isn't there. There is nothing to scroll.",
        },
        {
          label: "The urge",
          body: "You open Talysman to loosen the rule. Loosening it, like ending the session, needs the key — and the indicator is red.",
        },
        {
          label: "Back to work",
          body: "The drive is in the kitchen. You close the tab and write the code the video was for.",
        },
      ],
      media: {
        label: "YouTube in focus: search and a video work, the feed is gone",
        note: "Screen recording: YouTube search → video playing with no sidebar → click logo → empty home → Talysman End session → “Insert your key to turn off the blocker” → cut to the drive in another room.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "cards",
      title: "The parts that matter after week one",
      lede: "Anyone can block YouTube once. These decide whether it's still blocked in March.",
      cards: [
        {
          title: "Recurring windows arm themselves",
          body: "Schedule your two best hours and the block starts without you — even if the app is closed and you never remembered to press start. That's Pro.",
        },
        {
          title: "Quitting the app changes nothing",
          body: "Enforcement is a privileged background service. Closing the window, killing the process, or rebooting all leave the session running.",
        },
        {
          title: "The desktop app is covered too",
          body: "App blocking covers desktop clients you add to the list, so a YouTube app isn't a way around the site rule. App blocking is Pro.",
        },
        {
          title: "Your history stays yours",
          body: "The extension never receives the URLs you visit, your history, page content, or search terms.",
        },
      ],
    },
    {
      kind: "honesty",
      title: "What a site rule doesn't do",
      body: (
        <>
          <p>
            It hides the parts of YouTube built to keep you watching. It can&apos;t tell a tutorial
            from a video essay you searched for on purpose. If the search box itself is the problem,
            block the domain — or use allow-only mode and permit just the tools your work needs.
          </p>
          <p>
            And the usual caveat: with administrator rights on your own computer you can eventually
            force past any blocker. The claim is that the cheap exits are gone, not that there are
            none.
          </p>
        </>
      ),
    },
    {
      kind: "faq",
      items: [
        {
          q: "Can I block YouTube but still watch tutorials?",
          a: (
            <p>
              Yes. The YouTube site rule keeps search and videos you open directly, and hides the
              home feed, recommendations, sidebar and end screens. You find the tutorial; YouTube
              doesn&apos;t get to suggest the next twelve.
            </p>
          ),
        },
        {
          q: "Can I block Shorts specifically?",
          a: <p>Yes. Shorts is a separate switch in the YouTube site rule.</p>,
        },
        {
          q: "Which browsers are supported?",
          a: (
            <p>
              Chrome and Firefox have extensions. Site rules need the extension, so Strict Mode stays
              on while one is active and closes any browser without it during focus.
            </p>
          ),
        },
        {
          q: "Is blocking YouTube free?",
          a: (
            <p>
              Yes. Free covers {FREE_BLOCKED_SITE_LIMIT} websites or site rules, unlimited manual
              sessions and the key requirement, with no card. Recurring schedules and desktop app
              blocking are Pro, free for {PRO_TRIAL_DAYS} days — <Link href="/pricing">see pricing</Link>.
            </p>
          ),
        },
      ],
    },
  ],
  cta: {
    heading: "Keep the tutorial, lose the rabbit hole",
    body: "Pair a drive, add the YouTube site rule, unplug the key, and see how the afternoon goes.",
  },
  graphic: {
    kind: "compare",
    title: "YouTube while working: keep the tutorial, lose the feed",
    caption: "What Talysman's YouTube site rule hides and keeps, next to blocking YouTube outright.",
    fromTable: "Two ways to block YouTube",
    rows: [
      "Search",
      "Videos you open from a link or search",
      "Home feed",
      "Recommendations, sidebar, end screens",
      "YouTube Studio and uploads",
      "Best for",
    ],
  },
  related: [
    "focus-app-developers",
    "block-reddit-while-working",
    "block-social-media-on-computer",
    "physical-website-blocker",
  ],
};
