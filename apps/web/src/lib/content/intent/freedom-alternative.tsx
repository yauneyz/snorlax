import Link from "next/link";
import { FREE_BLOCKED_SITE_LIMIT, PRO_DEVICE_LIMIT } from "@talysman/product";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * Freedom's strength is breadth — it covers the phone, which we don't. Conceding that in a
 * section of its own is not modesty; it's the reason the rest of the page is believable, and it
 * sends the wrong-fit visitor away before they pay for something that won't solve their problem.
 */
export const freedomAlternative: IntentPage = {
  slug: "freedom-alternative",
  group: "compare",
  summary: "Freedom’s Locked Mode against a session only a physical key can end.",
  lastReviewed: "2026-10-07",
  showLastReviewed: true,
  intent: "freedom alternative / freedom vs talysman for a remote worker",
  eyebrow: "Freedom alternative",
  title: "Freedom alternative for desktop focus: Talysman vs Freedom",
  metaTitle: "Freedom Alternative for Desktop Focus: Talysman vs Freedom",
  metaDescription:
    "Compare Freedom's cross-device blocking with Talysman's physical-key approach to focused desktop work.",
  lede: (
    <>
      Freedom is broad — every device, one list. {config.app.name} is narrow: the machine where
      your work happens, and an off switch that isn&apos;t in the room.
    </>
  ),
  answer: (
    <>
      <p>
        Freedom blocks distractions across your phone, tablet and computer from one account, and its
        Locked Mode stops you quitting the app or ending a session early. The way out is in
        software: Freedom lets you end a locked session from its web dashboard once every seven
        days.
      </p>
      <p>
        {config.app.name} trades that breadth for a different kind of certainty. It only covers
        desktops — Windows, macOS and Linux — and ending a focus session early requires a paired USB
        drive to be physically plugged into the machine. If the drive is in the kitchen, the session
        holds, and no amount of clicking, quitting or rebooting changes that.
      </p>
    </>
  ),
  sections: [
    {
      kind: "table",
      title: "Two different bets",
      lede: "One covers more devices. One puts the off switch out of reach.",
      columns: ["", "Cross-device blockers like Freedom", `${config.app.name}`],
      rows: [
        [
          "Devices covered",
          "Phone, tablet and computer from one account",
          "Windows, macOS and Linux desktops only",
        ],
        [
          "What ends a session early",
          "Locked Mode: a session can be ended from the web dashboard once every 7 days",
          "A paired USB drive plugged into the computer",
        ],
        [
          "Where the block is enforced",
          "In the app and its browser extensions",
          "In a privileged background service, below the browser",
        ],
        [
          "If you kill it or reboot",
          "Depends on the product's own protections",
          "The service restarts and the session comes back intact",
        ],
        [
          "Uninstalling mid-session",
          "Uninstall prevention is available on Windows",
          "On Windows and Linux, the uninstaller refuses without a paired key present; macOS has no uninstaller to gate",
        ],
        [
          "Desktop apps, not just sites",
          "Varies by plan and platform",
          "Yes — apps go on the list alongside domains",
        ],
        [
          "What you have to buy",
          "A subscription",
          "Free for the core mechanism; Pro by subscription or one lifetime payment. The key is a drive you own",
        ],
      ],
      highlightLast: true,
      footnote: (
        <>
          {config.app.name} isn&apos;t affiliated with Freedom. Locked Mode details are from{" "}
          <a href="https://support.freedom.to/en/articles/1802927-locked-mode" rel="nofollow noopener">
            Freedom&apos;s help center
          </a>
          , which is the authority on what Freedom does today.
        </>
      ),
    },
    {
      kind: "demo",
      title: "What a physical lock adds",
      lede: "The beat where a software lock and a physical one stop being the same product.",
      beats: [
        {
          label: "Session running",
          body: "Sites blocked in Chrome and Firefox, desktop apps blocked too, everything else on the computer working normally.",
        },
        {
          label: "You want out",
          body: "Forty minutes in, the task turns unpleasant and you go for the off switch.",
        },
        {
          label: "The refusal",
          body: "“Insert your key to turn off the blocker.” The indicator is red. The service checked the machine for a paired drive and didn't find one.",
        },
        {
          label: "The workarounds",
          body: "Quitting the app does nothing. Killing the service restarts it. Rebooting brings the session back. On Windows and Linux, the uninstaller refuses. With Strict Mode on, a browser without the extension gets closed rather than left open.",
        },
        {
          label: "The only door",
          body: "Two rooms away, on a kitchen counter, where you put it while you were thinking clearly. You can go get it. Most of the time you don't.",
        },
      ],
      media: {
        label: "30-second demo: the refusal and the exhausted workaround list",
        note: "Screen recording: End session → refusal dialog → quick cuts of quitting the app, killing the service, rebooting, each leaving the session running → cut to the drive in another room.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "prose",
      title: "When Freedom is the better choice",
      body: (
        <>
          <p>
            If your phone is the problem, stay with a cross-device tool. {config.app.name} does not
            block anything on iOS or Android and isn&apos;t going to pretend the desktop is the
            whole story — for a lot of people it genuinely isn&apos;t. Same if you need one blocklist
            synced across a household of devices, or if you work primarily on a tablet.
          </p>
          <p>
            The case for switching is narrow and specific: your real work happens on a computer, and
            the sessions you lose are the ones you end yourself, in software, in about five seconds.
            That&apos;s the failure a physical key is for. Everything else about {config.app.name} —
            the blocklist, the schedules, the modes — is table stakes that any decent blocker has.
          </p>
        </>
      ),
    },
    {
      kind: "cards",
      title: "What the desktop-only focus buys you",
      lede: "Not covering phones means everything goes into the machine where the work is.",
      cards: [
        {
          title: "Enforcement below the browser",
          body: "A privileged service holds the block, so the app window is just a remote control. Closing it changes nothing.",
        },
        {
          title: "Desktop apps on the list",
          body: "Discord, Steam, a chat client — blocked as applications, so the distraction can't change shape when the tab closes.",
        },
        {
          title: "Allow-only mode",
          body: "Block everything, then permit the handful of tools the job needs. A work computer without buying a second computer.",
        },
        {
          title: "Locked scheduled windows",
          body: "Opt in and even the key won't end focus early during the window. It releases on its own when the window is over — or with one of five lifetime emergency unlocks.",
        },
        {
          title: "Sessions that survive a reboot",
          body: "State lives in protected storage and the service starts with the machine. A crash isn't an escape hatch.",
        },
        {
          title: "Browsing that stays private",
          body: "The extension turns your list into browser-native rules and never receives your URLs, history, page content, or search terms.",
        },
      ],
    },
    {
      kind: "honesty",
      title: "The limits",
      body: (
        <>
          <p>
            No phone blocking, no tablet blocking, no household sync. Chrome and Firefox have
            extensions; other browsers are covered by the network-level block, and with Strict Mode on they are closed during focus rather than left open.
            Blocking is domain-level, so &ldquo;this YouTube video but not that one&rdquo;
            isn&apos;t a thing that exists here.
          </p>
          <p>
            And the usual caveat: with administrator rights on your own machine you can eventually
            force past any blocker, this one included. The claim is that the cheap exits are gone,
            not that there are none.
          </p>
        </>
      ),
    },
    {
      kind: "faq",
      items: [
        {
          q: "Can I run both?",
          a: (
            <p>
              Yes, and for some people that&apos;s the right answer — a cross-device tool for the
              phone, {config.app.name} for the computer where the deep work happens. They enforce
              independently.
            </p>
          ),
        },
        {
          q: "Does one subscription cover all my computers?",
          a: (
            <p>
              Yes. Pro is tied to your account and covers up to {PRO_DEVICE_LIMIT} computers at once.
              Pair the same USB drive on each machine — every computer keeps its own list of paired
              keys.
            </p>
          ),
        },
        {
          q: "What if I lose the key?",
          a: (
            <p>
              Pair spares. Any paired drive unlocks and you can pair as many as you like, so keep
              one somewhere safe before you need it. If every key is gone, each computer has five
              keyless emergency unlocks for life, and after one you can pair a new drive.
            </p>
          ),
        },
        {
          q: "Can I try it first?",
          a: (
            <p>
              Free covers the whole mechanism with no card: pair a key, block {FREE_BLOCKED_SITE_LIMIT} sites, run
              sessions you can&apos;t click your way out of.{" "}
              <Link href="/download?from=freedom-alternative">Download it</Link> and test it against a real workday.
            </p>
          ),
        },
      ],
    },
  ],
  cta: {
    heading: "Lock down the machine that matters most",
    body: "Pair a drive you already own, start a session, and leave the key in another room.",
  },
  graphic: {
    kind: "compare",
    title: "Freedom vs Talysman: where the way out lives",
    caption: "Freedom's Locked Mode and Talysman's USB key compared: devices, how a session ends early, and where blocking is enforced.",
    fromTable: "Two different bets",
    rows: [
      "Devices covered",
      "What ends a session early",
      "Where the block is enforced",
      "Uninstalling mid-session",
    ],
  },
  related: [
    "focus-app-remote-work",
    "cold-turkey-vs-freedom-vs-focusme",
    "cold-turkey-alternative",
    "brick-for-computer",
    "website-blocker-you-cant-turn-off",
  ],
};
