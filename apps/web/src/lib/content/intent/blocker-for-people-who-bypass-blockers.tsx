import Link from "next/link";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * The highest-intent query in the set: someone typing this has already bought and defeated at
 * least one blocker, and arrives expecting to be told they lack discipline. Leading with "the
 * bypass was a design failure, not a character failure" is both the honest read and the only
 * framing that doesn't sound like the last three products they tried.
 */
export const blockerForPeopleWhoBypassBlockers: IntentPage = {
  slug: "blocker-for-people-who-bypass-blockers",
  intent: "best blocker for people who bypass blockers",
  eyebrow: "For people who bypass blockers",
  title: "The blocker for people who always end up bypassing the blocker",
  metaTitle: `The Best Blocker for People Who Bypass Blockers | ${config.app.name}`,
  metaDescription:
    "If you've uninstalled every blocker you've installed, the problem isn't discipline — the off switch was always within reach. Talysman moves it onto a USB key you leave in another room.",
  lede: (
    <>
      You&apos;ve disabled the extension, whitelisted &ldquo;just for a minute&rdquo;, and
      uninstalled the app twice. That&apos;s not a discipline problem. It&apos;s a distance
      problem.
    </>
  ),
  answer: (
    <>
      <p>
        Every blocker you&apos;ve bypassed had the same flaw: the thing that ends the block was
        within arm&apos;s reach of the person who wanted to end it. A button, a password you chose,
        a timer, an uninstaller. At 2pm on a hard task, all of those are the same distance away —
        about five seconds.
      </p>
      <p>
        {config.app.name} moves the off switch onto a physical object. Ending a focus session early
        requires a paired USB drive plugged into the computer, and the drive is wherever you left
        it. Every workaround you already know — quitting the app, killing the service, rebooting,
        uninstalling, switching browsers — ends at the same place: go get the key, or go back to
        work.
      </p>
    </>
  ),
  sections: [
    {
      kind: "prose",
      title: "The five seconds that beat every blocker you've owned",
      body: (
        <>
          <p>
            Nobody sits down and decides to lose an afternoon. What happens is smaller than that.
            The task turns ambiguous, or boring, or slightly humiliating, and some part of you goes
            looking for an exit before the rest of you has agreed there is one. If an exit is one
            click away, you take it — and you notice you took it about ten minutes later, on
            YouTube, with no memory of deciding.
          </p>
          <p>
            That&apos;s why more willpower doesn&apos;t fix it and stronger software locks
            mostly don&apos;t either. A password you know is a password you type. A timer is
            something you wait out with a second tab open. A random string to retype is a toll
            you&apos;ll pay once and then pay faster the next time. Each one is still a decision
            made at the keyboard, in the exact second you are least equipped to make it.
          </p>
          <p>
            The only thing that reliably beats a five-second impulse is making the escape take
            longer than the impulse lasts. Not a wall — a walk.
          </p>
        </>
      ),
    },
    {
      kind: "table",
      title: "Your usual move, and where it lands here",
      lede: "Be honest about which line is yours. Then check what it costs.",
      columns: ["How you normally get out", "What happens with a session running"],
      rows: [
        [
          "Click the off switch",
          "The service checks for your paired key. It isn't plugged in, so focus stays on. There's no override button.",
        ],
        [
          "Add a temporary exception “just for one thing”",
          "Loosening the list mid-session is key-gated the same way turning it off is.",
        ],
        [
          "Quit the app",
          "The window isn't doing the blocking. The background service is, and it doesn't care that you closed anything.",
        ],
        [
          "End the process in Task Manager",
          "The service restarts and picks the session back up where it was.",
        ],
        [
          "Reboot",
          "The session is written to protected storage and the service starts with the machine.",
        ],
        [
          "Uninstall it",
          "The uninstaller refuses to remove the service during an active session unless a paired key is present.",
        ],
        [
          "Disable the extension, or open a different browser",
          "A browser that can't enforce the list gets closed during a locked session rather than left standing open.",
        ],
        [
          "Go get the drive",
          "It works. It costs you a walk, and by the time you're back you usually don't want it any more.",
        ],
      ],
    },
    {
      kind: "demo",
      title: "Watch the bypass fail",
      lede: "Eleven seconds of a person not losing an afternoon.",
      beats: [
        {
          label: "The urge",
          body: "Forty minutes into something hard, you alt-tab without quite deciding to. Block page. So you open Talysman instead — this is the part where every other blocker loses.",
        },
        {
          label: "The click",
          body: "End session. A dialog: “Insert your key to end early.” The key indicator is red.",
        },
        {
          label: "The math",
          body: "The drive is in the kitchen, where you put it forty minutes ago while you were thinking clearly. Two rooms and a decision away.",
        },
        {
          label: "The result",
          body: "You close the dialog and go back to the editor. The impulse cost eleven seconds instead of an hour.",
        },
      ],
      outcome: (
        <p>
          And when you <em>do</em> go get it, that&apos;s fine. A choice made on your feet after a
          walk is a real choice. The goal was never to trap you — it was to stop the version of you
          that&apos;s five minutes deep in frustration from spending the afternoon on your behalf.
        </p>
      ),
      media: {
        label: "30-second demo: the workaround that doesn't work",
        note: "Screen recording. Alt-tab → block page → End session → refusal dialog, red key indicator → cut to the drive on a kitchen counter → cut back, typing resumes.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "cards",
      title: "Built for the second week, not the first day",
      lede: "Anyone can stay focused on the day they install something. These are the parts aimed at the day the novelty is gone.",
      cards: [
        {
          title: "Schedules that arm themselves",
          body: "Your best hours get protected whether or not you remember to start a session — which matters, because on the days you'd most benefit you won't remember.",
        },
        {
          title: "Locked windows",
          body: "Mark a scheduled window locked and even the key won't end it early. It releases on its own. Opt-in, for the hours you know you'll try to negotiate with.",
        },
        {
          title: "Apps, not just tabs",
          body: "If Discord or Steam is your version of the problem, closing the browser doesn't help. Desktop apps go on the list too.",
        },
        {
          title: "Allow-only mode",
          body: "Block everything, then permit the four tools the work needs. There's nothing left to negotiate with.",
        },
      ],
    },
    {
      kind: "honesty",
      title: "If you're technical, read this part",
      body: (
        <>
          <p>
            You&apos;re going to try to break it. That&apos;s fine, and we&apos;d rather set
            expectations than have you feel misled: with administrator rights on your own machine
            and enough determination, you can get past any blocker, including this one. Nothing
            installed on a computer you control can honestly promise otherwise.
          </p>
          <p>
            What&apos;s true is that the bypasses left are the expensive kind — the kind that take
            real time, deliberate effort, and full attention. That&apos;s a different category from
            the click that has been ending your sessions, and it&apos;s the only category that
            matters, because the impulse doesn&apos;t survive that long.
          </p>
        </>
      ),
    },
    {
      kind: "faq",
      items: [
        {
          q: "I've uninstalled every blocker I've bought. Why is this different?",
          a: (
            <p>
              Because uninstalling is key-gated too. During an active session the uninstaller
              refuses to remove the enforcement service without a paired drive present, so the
              escape hatch you&apos;ve used every time before opens onto the same walk as everything
              else.
            </p>
          ),
        },
        {
          q: "What if I just keep the key plugged in?",
          a: (
            <p>
              Then you&apos;ve got a blocker with a one-click off switch, and you already know how
              that ends. The mechanism <em>is</em> the distance. If you don&apos;t trust yourself to
              move the drive, schedule a locked window instead — nothing ends those early, key
              included.
            </p>
          ),
        },
        {
          q: "Can I try it before paying?",
          a: (
            <p>
              Yes, and you should — this is a product you should be allowed to attack before you
              trust. Free covers the whole mechanism: pair a key, block sites, run locked sessions,
              no card. <Link href="/pricing">Pricing is here</Link> when you want schedules and app
              blocking.
            </p>
          ),
        },
      ],
    },
  ],
  cta: {
    heading: "Try to bypass it. That's the demo.",
    body: "Start a free session, unplug the key, and run through your whole list of workarounds.",
  },
  related: [
    "website-blocker-you-cant-disable",
    "how-to-stop-disabling-website-blockers",
    "cold-turkey-alternative",
  ],
};
