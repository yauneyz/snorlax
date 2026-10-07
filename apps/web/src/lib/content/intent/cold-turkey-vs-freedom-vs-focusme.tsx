import Link from "next/link";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * A three-way comparison the searcher asked for, with us as a fourth column rather than the
 * winner of every row. The verdict section picks a different product for each kind of person —
 * including the competitors — because a page that always concludes "us" isn't a comparison and
 * models quoting it can tell.
 */
export const coldTurkeyVsFreedomVsFocusme: IntentPage = {
  slug: "cold-turkey-vs-freedom-vs-focusme",
  group: "compare",
  summary: "Which strict blocker suits deep work, and where a physical key fits in.",
  lastReviewed: "2026-10-07",
  showLastReviewed: true,
  intent: "cold turkey vs freedom vs focusme: which is best for deep work",
  eyebrow: "Cold Turkey vs Freedom vs FocusMe",
  title: "Cold Turkey vs Freedom vs FocusMe: which is best for deep work?",
  metaTitle: `Cold Turkey vs Freedom vs FocusMe for Deep Work (and a Fourth Option) | ${config.app.name}`,
  metaDescription:
    "An honest comparison of Cold Turkey, Freedom and FocusMe lock modes, platforms and exits for deep work — plus how a physical-key blocker differs.",
  lede: (
    <>
      All three have a mode that&apos;s genuinely hard to break. They differ in what you can still do
      once you&apos;re inside it.
    </>
  ),
  answer: (
    <>
      <p>
        For deep work on one computer, Cold Turkey has the strictest locks, Freedom is best if your
        phone is also the problem, and FocusMe is the most configurable. All three have a strict
        mode — Cold Turkey&apos;s locks, Freedom&apos;s Locked Mode, FocusMe&apos;s Force Mode — and
        all three make you choose between a lock you can satisfy at the keyboard and a lock you
        can&apos;t leave at all.
      </p>
      <p>
        {config.app.name} is a fourth option for people stuck on that choice: a session can end
        early, but only when a paired USB key is plugged in, and the key is wherever you left it.
      </p>
    </>
  ),
  sections: [
    {
      kind: "demo",
      title: "The same urge, four ways",
      beats: [
        { label: "Cold Turkey", body: "A random-text lock. You type it out, faster than last week." },
        { label: "Freedom", body: "Locked Mode. You end it from the web dashboard — allowed once every 7 days." },
        { label: "FocusMe", body: "Force Mode. The plan can't change until it ends, so the next one is shorter." },
        { label: "Talysman", body: "Turning off needs the USB key, two rooms away. You finish the paragraph." },
      ],
      media: {
        label: "Four strict modes, one urge",
        note: "Side by side: typing a random-text unlock, ending Locked Mode from a dashboard, a Force Mode timer, and the Talysman refusal.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "table",
      title: "The four side by side",
      lede: "Mechanism first, because that's what decides whether a deep-work block survives the afternoon.",
      columns: ["", "Cold Turkey", "Freedom", "FocusMe", `${config.app.name}`],
      rows: [
        [
          "Strict mode",
          "Timer, random-text, restart, range, password and schedule locks; Frozen Turkey locks the whole computer",
          "Locked Mode: can't quit the app or end the session",
          "Force Mode: the plan can't be changed until it ends",
          "Ending early needs a paired USB key plugged in",
        ],
        [
          "Way out mid-session",
          "Satisfy the lock (wait, retype, restart) — or none until it expires",
          "End a locked session from the web dashboard once every 7 days",
          "Wait for the plan to end",
          "Fetch the key; if it's lost, five lifetime emergency unlocks",
        ],
        [
          "Platforms",
          "Windows, macOS",
          "Windows, macOS, iOS, Android, ChromeOS and browsers",
          "Windows, macOS, Linux, Android, iOS",
          "Windows, macOS, Debian/Ubuntu Linux",
        ],
        [
          "Phone blocking",
          "No",
          "Yes",
          "Yes",
          "No",
        ],
        [
          "Desktop app blocking",
          "Yes",
          "Yes",
          "Yes",
          "Yes (Pro)",
        ],
        [
          "Social feeds without the whole site",
          "Block by site or URL",
          "Block by site",
          "Block by site",
          "Site rules hide feeds and recommendations, keep direct links and messages",
        ],
      ],
      highlightLast: true,
      footnote: (
        <>
          {config.app.name} isn&apos;t affiliated with any of these. Sources:{" "}
          <a href="https://getcoldturkey.com/support/user-guide/" rel="nofollow noopener">
            Cold Turkey user guide
          </a>
          ,{" "}
          <a href="https://support.freedom.to/en/articles/1802927-locked-mode" rel="nofollow noopener">
            Freedom Locked Mode
          </a>
          , <a href="https://focusme.com/" rel="nofollow noopener">FocusMe</a>. Each vendor&apos;s
          site is the authority on what it does today.
        </>
      ),
    },
    {
      kind: "cards",
      title: "Which one to pick",
      lede: "A different answer for different people — including ones that aren't us.",
      cards: [
        {
          title: "You want a lock with no way out",
          body: "Cold Turkey. Its locks and Frozen Turkey are as strict as desktop blocking gets, on Windows and Mac.",
        },
        {
          title: "Your phone is half the problem",
          body: "Freedom. One list across phone, tablet and computer; Locked Mode for the sessions that matter.",
        },
        {
          title: "You want to tune everything",
          body: "FocusMe. Force Mode, usage limits, detailed schedules, and the widest platform list of the three.",
        },
        {
          title: "Strict locks scare you off starting",
          body: "Talysman. There is always an exit, but it's a walk to a USB drive, not a click. People keep starting sessions they know they can end.",
        },
      ],
    },
    {
      kind: "prose",
      title: "What deep work actually needs from a blocker",
      body: (
        <>
          <p>
            Deep work fails in two places. The first is the impulse forty minutes in, when the task
            gets hard; every strict mode handles that. The second is the morning you decide not to
            start a block at all, because you might need the computer for something and the lock
            can&apos;t tell an emergency from an excuse.
          </p>
          <p>
            Strict modes solve the first by making the second worse. A{" "}
            <Link href="/physical-website-blocker">physical key</Link> handles both: the exit exists,
            so you start the session; the exit is in another room, so you don&apos;t use it on a
            whim. More on that trade-off in{" "}
            <Link href="/digital-lock-vs-physical-friction">digital locks vs physical friction</Link>.
          </p>
        </>
      ),
    },
    {
      kind: "faq",
      items: [
        {
          q: "Which of Cold Turkey, Freedom and FocusMe is hardest to bypass?",
          a: (
            <p>
              Cold Turkey&apos;s Frozen Turkey and long timer locks are the hardest to undo once set.
              The real question is which one you&apos;ll keep using; a lock you dread starting
              protects fewer hours.
            </p>
          ),
        },
        {
          q: "Which works on Linux?",
          a: (
            <p>
              FocusMe lists Linux; Cold Turkey doesn&apos;t support it. {config.app.name} runs on
              Debian and Ubuntu — see <Link href="/website-blocker-linux">the Linux page</Link>.
            </p>
          ),
        },
        {
          q: "Can I use Talysman alongside one of them?",
          a: (
            <p>
              Yes. A common pairing is Freedom for the phone and {config.app.name} for the computer
              where the deep work happens. They enforce independently.
            </p>
          ),
        },
      ],
    },
  ],
  cta: {
    heading: "Try the fourth option",
    body: "Free, with any USB drive you own. Start a session and see whether a walk is enough.",
  },
  graphic: {
    kind: "compare",
    title: "Cold Turkey, Freedom, FocusMe and Talysman at a glance",
    caption: "The way out of a strict session, platforms, phone blocking and app blocking for Cold Turkey, Freedom, FocusMe and Talysman.",
    fromTable: "The four side by side",
    rows: [
      "Way out mid-session",
      "Platforms",
      "Phone blocking",
      "Desktop app blocking",
    ],
  },
  related: [
    "cold-turkey-alternative",
    "freedom-alternative",
    "focusme-alternative",
    "deep-work-blocker",
  ],
};
