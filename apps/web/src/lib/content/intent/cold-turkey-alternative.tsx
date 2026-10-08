import Link from "next/link";
import { FREE_BLOCKED_SITE_LIMIT } from "@talysman/product";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * Cold Turkey is a good product with genuinely serious locks, and its users know that — a page
 * that pretends otherwise gets closed in four seconds. So: concede the strengths, state the one
 * real difference (their locks are conditions you endure at the keyboard; ours is a distance),
 * and keep every claim at the level of mechanism rather than feature list or price, both of
 * which change without telling us.
 */
export const coldTurkeyAlternative: IntentPage = {
  slug: "cold-turkey-alternative",
  group: "compare",
  summary: "A Cold Turkey alternative with a physical key and a limited emergency exit.",
  lastReviewed: "2026-10-07",
  showLastReviewed: true,
  intent:
    "cold turkey alternative / cold turkey alternative with an emergency exit / cold turkey vs talysman for deep work",
  eyebrow: "Cold Turkey alternative",
  title: "Cold Turkey alternative: Talysman vs Cold Turkey",
  metaTitle: "Cold Turkey Alternative: Talysman vs Cold Turkey",
  metaDescription:
    "Compare Talysman and Cold Turkey on enforcement, early exits, platforms, schedules and distraction blocking.",
  lede: (
    <>
      Cold Turkey&apos;s locks are real locks. They&apos;re also all things you can outlast without
      leaving your chair — and that&apos;s the seam this walks into.
    </>
  ),
  answer: (
    <>
      <p>
        If you want a Cold Turkey alternative that still has an emergency exit, {config.app.name}{" "}
        is one: sessions end early only with a physical USB key, and if the key is lost you get
        five keyless emergency unlocks per computer, for life.
      </p>
      <p>
        Cold Turkey Blocker is a serious desktop blocker and its locks are stronger than most. It
        offers a timer lock, a random-text lock you retype to unlock, a restart lock, time-range
        and schedule locks, a password lock on Pro, and Frozen Turkey, which locks you out of the
        whole computer. They resolve one of two ways: at the keyboard (wait, retype, restart), or
        not at all until the lock expires. Its user guide documents no emergency override.
      </p>
      <p>
        {config.app.name} sits between those. The escape costs distance instead of patience. Ending a session early requires a
        paired USB drive to be physically plugged into the machine, and the drive is in whatever
        room you left it in. Patience is something a frustrated person has plenty of at 2pm. A walk
        to the kitchen is the thing the impulse doesn&apos;t survive.
      </p>
    </>
  ),
  sections: [
    {
      kind: "prose",
      title: "What Cold Turkey gets right",
      body: (
        <>
          <p>
            It blocks below the browser, it covers desktop applications, and its locks were designed
            by someone who clearly understood that the user is the adversary. If your blocker is a
            browser extension with a disable toggle, moving to Cold Turkey is a real upgrade and you
            should do it.
          </p>
          <p>
            We&apos;re not here to tell you it doesn&apos;t work. We&apos;re here for the specific
            person for whom it stopped working — the one who has learned exactly how long the
            restart takes, or who types the random string fast now, or who found that the timer is
            perfectly survivable with a phone in hand.
          </p>
        </>
      ),
    },
    {
      kind: "table",
      title: "Where the two differ",
      lede: "Same category, different bet about what actually stops a person mid-impulse.",
      columns: ["", "Lock methods like Cold Turkey's", `${config.app.name}`],
      rows: [
        [
          "What ends a block early",
          "A condition you satisfy: a timer, a restart, retyping random text, a password",
          "A physical object plugged into the computer",
        ],
        [
          "Where you are when you do it",
          "At your desk, in the moment you wanted out",
          "Standing up, in another room, a minute later",
        ],
        [
          "What it costs you",
          "Patience and typing",
          "A walk — and usually you don't take it",
        ],
        [
          "Who can undo it",
          "You, since you set the condition",
          "Whoever is holding the drive, which is normally still you — just later",
        ],
        [
          "The absolute setting",
          "Locks that run until they expire, and Frozen Turkey for the whole computer",
          "Locked scheduled windows that even the key won't end early",
        ],
        [
          "Emergency exit",
          "None documented — a lock runs until it expires",
          "Five keyless emergency unlocks per computer, for life",
        ],
        ["Platforms", "Windows and macOS", "Windows, macOS, and Debian/Ubuntu Linux"],
        [
          "What you buy",
          "A one-time Pro license; the basic blocker is free",
          "Free for the core mechanism; Pro by subscription or a one-time lifetime payment. The key is a USB drive you already own",
        ],
      ],
      highlightLast: true,
      footnote: (
        <>
          {config.app.name} isn&apos;t affiliated with Cold Turkey. Cold Turkey&apos;s lock types and
          platforms are from its{" "}
          <a href="https://getcoldturkey.com/support/user-guide/" rel="nofollow noopener">
            user guide
          </a>
          , which is the authority on what it does and costs today.
        </>
      ),
    },
    {
      kind: "prose",
      id: "emergency-exit",
      title: "If you don't want a completely irreversible lock",
      lede: "Most people who leave Cold Turkey aren't leaving because it's too weak. They leave because an unbreakable lock is scary to start.",
      body: (
        <>
          <p>
            A lock with no way out works until the day something real happens mid-session. Then you
            learn to set shorter blocks, or to skip them on days that might go sideways. That&apos;s
            how a strict blocker ends up protecting fewer hours than a lenient one.
          </p>
          <p>
            {config.app.name} keeps two exits, neither of them on your desk. The everyday one is the
            key: walk to wherever you left it, plug it in, end the session. The emergency one is for
            a lost or broken key: five keyless emergency unlocks per computer, for life. Using one
            turns everything off, even locked windows, resets your streak, and can never be undone.
            Five is enough for a real emergency and too few to spend on a bad afternoon.
          </p>
        </>
      ),
    },
    {
      kind: "demo",
      title: "The difference in one interaction",
      lede: "Everything before the third beat is identical in both products.",
      beats: [
        {
          label: "The setup",
          body: "Sites and desktop apps on a blocklist. A session running. Same as you have now.",
        },
        {
          label: "The urge",
          body: "The work goes sideways around minute forty and you go looking for the off switch.",
        },
        {
          label: "The lock",
          body: "In a timer-or-typing lock, there's something you can do right now: wait, retype, restart. In Talysman, the greyed-out Turn off button says “Insert your key to turn off the blocker” and the key indicator is red. There is nothing to do at the desk.",
        },
        {
          label: "The walk",
          body: "The drive is in the kitchen. Getting it takes ninety seconds of deliberate, upright, fully conscious effort — which is about eighty-five seconds more than the impulse lasts.",
        },
        {
          label: "The outcome",
          body: "You go back to work. Not because you were stopped, but because the cheapest thing available was finishing the paragraph.",
        },
      ],
      media: {
        label: "Side by side: a lock you can satisfy vs a key you have to fetch",
        note: "Screen recording. Left: typing out a long unlock string. Right: the Talysman refusal dialog and a cut to the drive in another room.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "cards",
      title: "What you'd be getting",
      cards: [
        {
          title: "The same enforcement depth",
          body: "A privileged background service, not a browser extension. Closing the app, killing the process, and rebooting all leave the session running.",
        },
        {
          title: "A key-gated uninstaller on Windows and Linux",
          body: "It refuses to remove the service mid-session without a paired drive present, so uninstalling isn't the loophole. macOS has no uninstaller to put that check in.",
        },
        {
          title: "Websites and desktop apps",
          body: "Blocklist, allow-only, and block-all-internet modes, covering apps as well as tabs.",
        },
        {
          title: "Schedules that arm themselves",
          body: "Recurring windows start without you, including on the mornings you'd have skipped it.",
        },
        {
          title: "Multiple keys, multiple machines",
          body: "Pair spares so a lost drive isn't a lockout, and pair the same drive on your laptop and desktop.",
        },
        {
          title: "Windows, macOS and Linux",
          body: "Windows 10 and 11, macOS on Apple Silicon and Intel, and Debian/Ubuntu Linux, with Chrome and Firefox extensions.",
        },
      ],
    },
    {
      kind: "honesty",
      title: "When you shouldn't switch",
      body: (
        <>
          <p>
            If your current locks are holding, stay. A blocker you&apos;ve already configured and
            still respect is worth more than a better mechanism you have to set up again.
          </p>
          <p>
            Switch if — and only if — you recognise the specific failure this fixes: you get out,
            reliably, by satisfying whatever condition you set, and you&apos;ve stopped believing
            your own locks. That&apos;s the problem a physical key solves. It isn&apos;t a better
            blocklist; it&apos;s a longer distance between the impulse and the exit.
          </p>
        </>
      ),
    },
    {
      kind: "faq",
      items: [
        {
          q: "Can I keep both?",
          a: (
            <p>
              Nothing stops you, though two enforcement layers on one machine is more setup than
              most people want to maintain. Most people who switch pick one and put the effort into
              a blocklist they trust.
            </p>
          ),
        },
        {
          q: "Is there an equivalent of a lock that can't be ended at all?",
          a: (
            <p>
              Yes: mark a scheduled window <em>locked</em> and even a paired key won&apos;t end
              focus early during it. It releases on its own when the window closes, and the only way
              out before then is spending one of your five lifetime emergency unlocks. It&apos;s
              opt-in, and it&apos;s the setting to use for hours you know you&apos;ll try to
              negotiate with.
            </p>
          ),
        },
        {
          q: "What does it cost?",
          a: (
            <p>
              Free covers the entire mechanism — pair a key, block {FREE_BLOCKED_SITE_LIMIT} sites, run
              locked sessions —
              with no card. Pro adds unlimited sites, desktop app blocking, schedules and unlimited
              profiles. <Link href="/pricing">See pricing</Link>.
            </p>
          ),
        },
      ],
    },
  ],
  cta: {
    heading: "Try the lock you can't satisfy from your chair",
    body: "Pair a drive, start a free session, and put the key somewhere that costs you a walk.",
  },
  graphic: {
    kind: "compare",
    title: "Cold Turkey vs Talysman: how a block ends early",
    caption: "How a Cold Turkey lock and a Talysman session each end early, what that costs you, and where each runs.",
    fromTable: "Where the two differ",
    rows: [
      "What ends a block early",
      "Where you are when you do it",
      "What it costs you",
      "Emergency exit",
      "Platforms",
    ],
  },
  related: [
    "cold-turkey-vs-freedom-vs-focusme",
    "digital-lock-vs-physical-friction",
    "freedom-alternative",
    "blocker-for-people-who-bypass-blockers",
    "physical-website-blocker",
  ],
};
