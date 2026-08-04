import Link from "next/link";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * The one informational query in the set. It earns its ranking by being useful to someone who
 * never buys anything — four of the five tactics below cost nothing and don't involve us. The
 * pitch comes last, framed as the durable version of the same idea, because a how-to that turns
 * out to be an ad in the second paragraph is worth nothing to anyone.
 */
export const howToStopDisablingWebsiteBlockers: IntentPage = {
  slug: "how-to-stop-disabling-website-blockers",
  intent: "how to stop disabling website blockers",
  eyebrow: "How to stop disabling your blocker",
  title: "How to stop disabling your website blocker",
  metaTitle: `How to Stop Disabling Your Website Blocker — 5 Things That Work | ${config.app.name}`,
  metaDescription:
    "Five practical ways to stop turning off your own website blocker, from removing one-click exceptions to moving the off switch onto a physical object you have to go and fetch.",
  lede: (
    <>
      The fix isn&apos;t more resolve. It&apos;s making the off switch expensive enough that a
      five-second impulse can&apos;t afford it.
    </>
  ),
  answer: (
    <>
      <p>
        You disable your blocker for the same reason everyone does: the exit is within reach at the
        exact moment you want it. The reliable fix is to raise the price of unblocking until it
        costs more than the impulse is willing to pay — ideally by putting time, distance, or
        another person between you and the switch.
      </p>
      <p>
        Five things that work, roughly in order of how much they cost you to set up. The first four
        don&apos;t involve buying anything.
      </p>
    </>
  ),
  sections: [
    {
      kind: "steps",
      title: "Five things that actually work",
      steps: [
        {
          title: "Delete the one-click exception",
          body: (
            <>
              Most blockers ship with a snooze, a &ldquo;5 more minutes&rdquo;, or a per-site
              allow. That feature is the entire failure. Turn it off, or move to a tool without
              one. Every session you&apos;ve lost went through a button that was designed to be
              easy to press.
            </>
          ),
        },
        {
          title: "Decide when you're calm, and write it down",
          body: (
            <>
              Set the blocklist and the hours in the morning, or on Sunday — not at 2pm when
              you&apos;re already negotiating. A rule chosen in advance is something you break; a
              rule chosen in the moment is just a preference. Recurring schedules matter here far
              more than they sound like they should, because the version of you who would skip
              starting a session is the version who most needs one.
            </>
          ),
        },
        {
          title: "Use an admin account you don't stay logged into",
          body: (
            <>
              Do daily work in a standard user account and keep administrator rights in a separate
              one. Installing and removing enforcement software then needs a deliberate switch,
              which is enough friction to break the reflex. Have someone else set the admin password
              if you&apos;re willing — that turns uninstalling into a conversation.
            </>
          ),
        },
        {
          title: "Put the unlock on a device you don't have with you",
          body: (
            <>
              A password kept on paper in a drawer downstairs. A second phone in a bag. Anything
              that means unblocking requires standing up. This is the principle behind everything
              that works: an impulse is a short-lived thing, and it does not survive a walk.
            </>
          ),
        },
        {
          title: "Make the block hold when you close the app",
          body: (
            <>
              Test this today: start a session, quit the blocker, and see if the sites come back. If
              enforcement lives in the window you can close, you don&apos;t have a blocker — you
              have a reminder. What you want is enforcement in a background service that survives
              being quit, killed, and rebooted.
            </>
          ),
        },
      ],
    },
    {
      kind: "prose",
      title: "Why willpower isn't the variable",
      body: (
        <>
          <p>
            Nobody decides to lose an afternoon. The task gets ambiguous or boring or slightly
            humiliating, some part of you goes looking for an exit before the rest has agreed there
            is one, and if the exit is one click away you&apos;re through it before you notice you
            decided. Ten minutes later you&apos;re somewhere else with no memory of choosing to be.
          </p>
          <p>
            That&apos;s a five-second window. You cannot out-discipline it reliably, because by the
            time discipline is relevant the decision has already been made. What you can do is make
            sure that during those five seconds, the cheapest available action is the work.
          </p>
          <p>
            Which is why software locks mostly don&apos;t hold. A password you chose is a password
            you type. A timer is something you wait out with a second tab open. A random string to
            retype is a toll — you pay it once, then you pay it faster. Each is still a decision
            made at your desk, in the worst possible second.
          </p>
        </>
      ),
    },
    {
      kind: "demo",
      title: "The durable version: move the switch off the desk",
      lede: `${config.app.name} is tactic four, built in: the unlock is a USB drive you already own, and it only works when it's plugged in.`,
      beats: [
        {
          label: "Pair",
          body: "Plug in any USB drive and pair it. That drive is now the key for this computer. Pair a spare while you're there.",
        },
        {
          label: "Block",
          body: "Add the sites, add the desktop apps, or flip to allow-only and permit just the tools the work needs.",
        },
        {
          label: "Unplug",
          body: "Take the drive out and leave it somewhere that costs you a walk. This is the whole trick, and it's the step people skip.",
        },
        {
          label: "Try to quit",
          body: "Forty minutes in you click End session. “Insert your key to end early.” The indicator is red. Quitting the app, killing the service, rebooting and uninstalling all leave the session running.",
        },
        {
          label: "Go back to work",
          body: "Or go get the drive — deliberately, on your feet. Both are fine. What's gone is the version where you didn't notice you decided.",
        },
      ],
      media: {
        label: "30-second demo: what a blocker you can't disable looks like",
        note: "Screen recording: End session → refusal dialog with red key indicator → cut to the USB drive in another room → cut back, work resumes.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "table",
      title: "How much each fix actually costs you",
      lede: "Rank your own options by the second column. That's the one that predicts whether it holds.",
      columns: ["The fix", "What unblocking costs", "Holds under pressure?"],
      rows: [
        ["Extension with a disable toggle", "One click", "No"],
        ["Password you chose yourself", "Typing", "No"],
        ["Password held by a friend", "One message, if they answer", "Sometimes"],
        ["Random string to retype", "30–60 seconds", "For a while"],
        ["Timer you wait out", "Patience", "For a while"],
        ["Separate admin account", "Logging out and back in", "Usually"],
        ["Physical key in another room", "Standing up and walking", "Yes, if you actually put it there"],
      ],
      highlightLast: false,
    },
    {
      kind: "honesty",
      title: "The part no blocker can fix",
      body: (
        <>
          <p>
            None of this survives a determined, clear-headed decision to get back online, and
            it&apos;s not supposed to. With administrator rights on your own machine you can
            eventually force past any blocker, {config.app.name} included.
          </p>
          <p>
            The target is narrower: the unconscious exit. If quitting requires a walk to another
            room, you&apos;ll still quit sometimes — but you&apos;ll be awake when you do, and
            that&apos;s the difference between a decision and a lapse.
          </p>
        </>
      ),
    },
    {
      kind: "faq",
      items: [
        {
          q: "What's the single highest-leverage change?",
          a: (
            <p>
              Removing the one-click exception. Almost everyone who loses sessions loses them
              through a snooze or an allow-once button, not through a heroic bypass.
            </p>
          ),
        },
        {
          q: "Do accountability partners work?",
          a: (
            <p>
              They work while you&apos;re still willing to ask. They stop working the evening you
              decide not to send the message, which is exactly the evening you most needed them.
              Mechanisms that don&apos;t require a request tend to outlast the ones that do.
            </p>
          ),
        },
        {
          q: "Is there a setting where even the key won't work?",
          a: (
            <p>
              Yes — a scheduled window marked <em>locked</em>. Nothing ends focus early during it,
              and it releases on its own when the window closes. It&apos;s opt-in, and it&apos;s
              worth choosing while you&apos;re calm.
            </p>
          ),
        },
        {
          q: "Can I test this without paying?",
          a: (
            <p>
              Yes. The mechanism is free — pair a key, block five sites, run a session and try to
              end it early with the drive in another room. No card.{" "}
              <Link href="/download">Downloads are here</Link>.
            </p>
          ),
        },
      ],
    },
  ],
  cta: {
    heading: "Stop relying on being strong at 2pm",
    body: "Set the rules while you're calm, then put the off switch in another room.",
  },
  related: [
    "blocker-for-people-who-bypass-blockers",
    "website-blocker-you-cant-disable",
    "turn-a-usb-drive-into-a-distraction-blocker",
  ],
};
