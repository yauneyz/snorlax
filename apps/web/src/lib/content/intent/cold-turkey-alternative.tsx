import Link from "next/link";
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
  intent: "cold turkey alternative with a physical key",
  eyebrow: "Cold Turkey alternative",
  title: "A Cold Turkey alternative where the lock is a physical key",
  metaTitle: `Cold Turkey Alternative With a Physical Key | ${config.app.name}`,
  metaDescription:
    "Cold Turkey's locks are conditions you endure at the keyboard — a timer, a restart, a string to retype. Talysman's lock is a USB drive in another room. Here's the honest comparison.",
  lede: (
    <>
      Cold Turkey&apos;s locks are real locks. They&apos;re also all things you can outlast without
      leaving your chair — and that&apos;s the seam this walks into.
    </>
  ),
  answer: (
    <>
      <p>
        Cold Turkey Blocker is a serious desktop blocker and its lock methods are stronger than most
        — conditions you can&apos;t just click past. But every one of them resolves at the keyboard:
        wait out a timer, sit through a restart, retype a long string, enter a password you chose.
        The escape is always available to you where you sit; it just costs you patience.
      </p>
      <p>
        {config.app.name} makes the escape cost distance instead. Ending a session early requires a
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
          "A condition you satisfy: waiting, restarting, retyping, a password",
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
          "Locks that run until they expire",
          "Locked scheduled windows that even the key won't end early",
        ],
        [
          "What you buy",
          "Software",
          "Software. The key is a USB drive you already own",
        ],
      ],
      highlightLast: true,
      footnote: (
        <>
          {config.app.name} isn&apos;t affiliated with Cold Turkey, and this compares mechanisms
          rather than feature lists — their site is the authority on what their product does and
          costs today. If a one-time license matters more to you than a physical lock, that&apos;s a
          real reason to stay where you are: {config.app.name} is a subscription.
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
          body: "In a timer-or-typing lock, there's something you can do right now: wait, retype, restart. In Talysman, the dialog says “Insert your key to end early” and the key indicator is red. There is nothing to do at the desk.",
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
          title: "A key-gated uninstaller",
          body: "It refuses to remove the service mid-session without a paired drive present, so uninstalling isn't the loophole.",
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
              focus early during it. It releases on its own when the window closes. It&apos;s
              opt-in, and it&apos;s the setting to use for hours you know you&apos;ll try to
              negotiate with.
            </p>
          ),
        },
        {
          q: "What does it cost?",
          a: (
            <p>
              Free covers the entire mechanism — pair a key, block five sites, run locked sessions —
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
  related: [
    "freedom-alternative-for-desktop",
    "blocker-for-people-who-bypass-blockers",
    "physical-website-blocker",
  ],
};
