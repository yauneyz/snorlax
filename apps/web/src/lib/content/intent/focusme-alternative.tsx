import Link from "next/link";
import { FREE_BLOCKED_SITE_LIMIT } from "@talysman/product";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * FocusMe is the most configurable of the strict blockers — Force Mode, uninstall protection,
 * Task Manager and command-prompt blocking — and it lists Linux. Conceding all of that is the
 * price of being believed. The difference worth a page is not strength but shape: FocusMe makes
 * a running plan as hard to change as possible; Talysman makes it easy to change for exactly one
 * person — whoever is holding the key.
 */
export const focusmeAlternative: IntentPage = {
  slug: "focusme-alternative",
  group: "compare",
  summary: "FocusMe's Force Mode against a session that ends early only with a physical key.",
  lastReviewed: "2026-10-07",
  showLastReviewed: true,
  intent: "focusme alternative",
  eyebrow: "FocusMe alternative",
  title: "FocusMe alternative: physical focus blocking with Talysman",
  metaTitle: "FocusMe Alternative: Physical Focus Blocking with Talysman",
  metaDescription:
    "Compare FocusMe's enforced blocking with Talysman's simple physical-key commitment mechanism.",
  lede: (
    <>
      FocusMe gives you a hundred ways to make a plan hard to undo. {config.app.name} gives you one
      way to undo it, and puts it in another room.
    </>
  ),
  answer: (
    <>
      <p>
        If you want a FocusMe alternative with a simpler commitment mechanism, {config.app.name}{" "}
        blocks websites and desktop apps on Windows, macOS and Linux, and lets you end a session
        early only by plugging in a paired USB key.
      </p>
      <p>
        FocusMe&apos;s Force Mode makes a running plan very hard to change until it ends, and it can
        add uninstall protection and block tools like Task Manager. That&apos;s strength through
        settings. {config.app.name} takes the opposite bet: fewer settings, and one exit that is
        always available — but only to someone willing to stand up and fetch the key.
      </p>
    </>
  ),
  sections: [
    {
      kind: "prose",
      title: "What FocusMe does well",
      body: (
        <>
          <p>
            Scope and control. Detailed schedules, usage limits, Force Mode, protection against
            uninstalling and against the system tools people use to kill a blocker. It runs on more
            platforms than most desktop blockers, phones included. If you like tuning a system until
            it fits exactly, FocusMe rewards that.
          </p>
          <p>
            The trade-off is the one every strict mode shares: once a forced plan is running, the
            only exit is waiting. People respond by forcing fewer plans, or shorter ones.
          </p>
        </>
      ),
    },
    {
      kind: "table",
      title: "Where the two differ",
      columns: ["", "FocusMe", `${config.app.name}`],
      rows: [
        [
          "What makes a session hard to end",
          "Force Mode: the plan can't be changed until it ends",
          "Ending early needs a paired USB key plugged in",
        ],
        [
          "Your way out mid-session",
          "Wait for the plan to finish",
          "Walk to the key — or, if it's lost, one of five lifetime emergency unlocks",
        ],
        [
          "Protection against kill and uninstall",
          "Optional uninstall protection, Task Manager and command-prompt blocking",
          "A privileged service that restarts when killed; key-gated uninstall on Windows and Linux",
        ],
        [
          "Platforms",
          "Windows, macOS, Linux, Android, iOS",
          "Windows, macOS, Debian/Ubuntu Linux — desktops only",
        ],
        [
          "Setup effort",
          "Many settings to choose",
          "Pair a drive, pick a list, start",
        ],
        [
          "Social sites without the feed",
          "Block or allow by site and schedule",
          "Site rules hide feeds on Reddit, YouTube, X and more while keeping direct links",
        ],
      ],
      highlightLast: true,
      footnote: (
        <>
          {config.app.name} isn&apos;t affiliated with FocusMe. FocusMe&apos;s modes and platforms
          are from <a href="https://focusme.com/" rel="nofollow noopener">its website</a>, which is
          the authority on what it does today.
        </>
      ),
    },
    {
      kind: "demo",
      title: "The difference in one interaction",
      lede: "Forty minutes into a hard task, in both products.",
      beats: [
        {
          label: "The urge",
          body: "The task stalls. You go looking for the off switch.",
        },
        {
          label: "FocusMe in Force Mode",
          body: "There isn't one. The plan runs until it ends — which is the point, and also why you'll set a shorter plan tomorrow.",
        },
        {
          label: "Talysman",
          body: "End session. “Insert your key to turn off the blocker.” The indicator is red. The key is on a shelf in the hallway.",
        },
        {
          label: "The decision",
          body: "You could go get it. Getting up turns an impulse into a decision, and most impulses don't survive being made into one.",
        },
      ],
      media: {
        label: "Side by side: a plan you can't change vs a key you have to fetch",
        note: "Screen recording. Left: a forced plan refusing edits. Right: the Talysman refusal dialog, then a cut to the drive in another room.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "honesty",
      title: "When you should stay with FocusMe",
      body: (
        <>
          <p>
            If you need phone blocking, detailed usage limits, or you genuinely want a lock with no
            exit, FocusMe covers ground {config.app.name} doesn&apos;t. If its Force Mode is holding
            and you&apos;re not dreading starting it, keep it.
          </p>
          <p>
            Switch if the strictness has started to work against you — if you&apos;ve stopped
            forcing plans because they&apos;re all-or-nothing. And as with any blocker: with admin
            rights on your own machine, you can eventually force past it. The goal is to make the
            cheap exits disappear.
          </p>
        </>
      ),
    },
    {
      kind: "faq",
      items: [
        {
          q: "Is Talysman stricter than FocusMe?",
          a: (
            <p>
              Not by every measure. A forced FocusMe plan has no exit until it ends; a{" "}
              {config.app.name} session has one, behind a physical key. For a lock with no key
              exit, mark a scheduled window <em>locked</em> — only an emergency unlock ends it early.
            </p>
          ),
        },
        {
          q: "Does Talysman work on Linux like FocusMe?",
          a: (
            <p>
              Yes, on Debian and Ubuntu. See the <Link href="/website-blocker-linux">Linux page</Link>{" "}
              for how it enforces there.
            </p>
          ),
        },
        {
          q: "Can I try it before switching?",
          a: (
            <p>
              Free covers the whole mechanism with no card: pair a key, block{" "}
              {FREE_BLOCKED_SITE_LIMIT} sites, and run sessions only the key can end early.{" "}
              <Link href="/download">Download it</Link>.
            </p>
          ),
        },
      ],
    },
  ],
  cta: {
    heading: "One exit, in another room",
    body: "Pair a drive, start a session, and see whether the walk is enough.",
  },
  graphic: {
    kind: "compare",
    title: "FocusMe vs Talysman: a plan you can't change, or a key you have to fetch",
    caption: "FocusMe's Force Mode and Talysman's USB key compared: what makes a session hard to end, the way out, protection and platforms.",
    fromTable: "Where the two differ",
    rows: [
      "What makes a session hard to end",
      "Your way out mid-session",
      "Protection against kill and uninstall",
      "Platforms",
    ],
  },
  related: [
    "cold-turkey-vs-freedom-vs-focusme",
    "cold-turkey-alternative",
    "digital-lock-vs-physical-friction",
  ],
};
