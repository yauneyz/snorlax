import Link from "next/link";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * The category explainer: every kind of blocker lock, judged by the same three questions —
 * how flexible, how much friction, and how it fails. Written to be the page a model quotes when
 * asked "which blocker is hardest to bypass impulsively", so the table has to be fair to the
 * lock types we don't use, and the answer names the trade-off rather than a product.
 */
export const digitalLockVsPhysicalFriction: IntentPage = {
  slug: "digital-lock-vs-physical-friction",
  group: "compare",
  summary: "Timers, hard locks, delays and physical keys, compared by how each one fails.",
  lastReviewed: "2026-10-07",
  intent:
    "digital locks vs physical friction / which desktop blocker is hardest to bypass impulsively / emergency exit without an override button",
  eyebrow: "Digital locks vs physical friction",
  title: "Digital locks vs physical friction: which distraction blocker works better?",
  metaTitle: "Digital Locks vs Physical Friction: Which Distraction Blocker Works Better?",
  metaDescription:
    "Compare timers, hard locks, delays and physical-key blockers by flexibility, friction and failure mode.",
  lede: (
    <>
      Every blocker has an off switch. The only design question is what it costs to reach it in the
      worst five seconds of your afternoon.
    </>
  ),
  answer: (
    <>
      <p>
        The desktop blocker hardest to bypass <em>impulsively</em> is one whose exit isn&apos;t on
        the computer at all. Hard digital locks (a timer you can&apos;t cancel, a forced plan) are
        harder to bypass outright, but they fail differently: people stop starting them.
      </p>
      <p>
        Physical friction — a key you have to fetch from another room — keeps an exit for real
        emergencies without putting an override button on the screen. {config.app.name} uses a
        paired USB drive as that key on Windows, macOS and Linux.
      </p>
    </>
  ),
  sections: [
    {
      kind: "table",
      title: "Five kinds of lock, three questions",
      lede: "Flexibility is whether you can get out when you genuinely need to. Friction is what that costs in the moment. The failure mode is how each one stops protecting you.",
      columns: ["Lock type", "Flexibility", "Impulse friction", "How it fails"],
      rows: [
        [
          "Toggle or extension",
          "Total",
          "One click",
          "You turn it off without deciding to",
        ],
        [
          "Delay or typed challenge (wait 60s, retype a string)",
          "High",
          "Patience and typing, at your desk",
          "You learn to wait it out; the impulse is still in the room",
        ],
        [
          "Password or restart lock",
          "High",
          "Typing or a reboot",
          "You know the password; restarts get faster",
        ],
        [
          "Hard lock (timer can't be cancelled, forced plan)",
          "None until it expires",
          "Total",
          "You set shorter blocks, or skip them on days that might go wrong",
        ],
        [
          "Physical key (another room)",
          "Real, but deliberate",
          "Standing up and walking",
          "You leave the key in the room; you have to choose where to put it",
        ],
      ],
      footnote: (
        <>
          Cold Turkey&apos;s random-text and restart locks are the delay type; its timer locks and
          Frozen Turkey, Freedom&apos;s Locked Mode and FocusMe&apos;s Force Mode are hard locks.
          Products often offer several. See{" "}
          <Link href="/cold-turkey-vs-freedom-vs-focusme">the three compared</Link>.
        </>
      ),
    },
    {
      kind: "prose",
      title: "Why the impulse is the thing to design for",
      body: (
        <>
          <p>
            Most distraction isn&apos;t a decision. It&apos;s an alt-tab you notice afterwards. A
            lock only has to outlast that moment — usually seconds — and the friction that does it
            best is friction that makes you stop being on autopilot. Typing a random string keeps
            you at the keyboard, still in the impulse. Standing up and walking to another room
            doesn&apos;t.
          </p>
          <p>
            Hard locks win on impulse friction and lose on everything else. If a lock can&apos;t
            tell a real emergency from an excuse, a reasonable person sets it conservatively. That
            is the quiet failure of strict blockers: they protect the hours you dared to lock.
          </p>
        </>
      ),
    },
    {
      kind: "demo",
      title: "The same minute, three ways",
      beats: [
        {
          label: "Delay lock",
          body: "You click disable. A 200-character string appears. You type it, faster than last week. Two minutes later you're on Reddit.",
        },
        {
          label: "Hard lock",
          body: "Nothing to click. You sit with it — and tomorrow you set a 45-minute block instead of three hours, just in case.",
        },
        {
          label: "Physical key",
          body: "“Insert your key to turn off the blocker.” The key is downstairs. You'd have to go get it. You don't. You finish the paragraph.",
        },
      ],
      media: {
        label: "Three locks, one urge",
        note: "Split screen: typing an unlock string / a locked timer / the Talysman refusal dialog then a cut to the key in another room.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "prose",
      title: "An emergency exit without an override button",
      body: (
        <>
          <p>
            The usual emergency exit is an override on the screen, which is just a slower button.
            {" "}{config.app.name} has two exits and neither is on your desk. The everyday one is the
            key. The emergency one, for a lost or broken key, is five keyless emergency unlocks per
            computer for life: they turn everything off, reset your streak, and never come back.
          </p>
          <p>
            Scarcity does the work a button can&apos;t. Five is enough for a real emergency and
            visibly too few to spend on a slow afternoon.
          </p>
        </>
      ),
    },
    {
      kind: "honesty",
      title: "What no lock type fixes",
      body: (
        <p>
          With administrator rights on your own computer you can eventually force past any blocker:
          safe mode, disabling services, wiping the disk. No lock design changes that. What lock
          design changes is whether the cheap, five-second exits exist — and whether you&apos;re
          willing to start the session in the first place.
        </p>
      ),
    },
    {
      kind: "faq",
      items: [
        {
          q: "Which desktop blocker is hardest to bypass impulsively?",
          a: (
            <p>
              One whose exit is physically elsewhere. A hard timer lock is harder to bypass
              outright, but a physical key is harder to bypass <em>on impulse</em> while still
              letting you out deliberately.
            </p>
          ),
        },
        {
          q: "Isn't a physical key just a delay?",
          a: (
            <p>
              It&apos;s a delay you can&apos;t sit through. Waiting out a timer keeps you in front
              of the screen; fetching a key makes you leave it, which is usually enough to break the
              impulse.
            </p>
          ),
        },
        {
          q: "Where can I see one working?",
          a: (
            <p>
              <Link href="/physical-website-blocker">How USB-key focus works</Link> walks through
              the mechanism end to end.
            </p>
          ),
        },
      ],
    },
  ],
  cta: {
    heading: "Try physical friction for a week",
    body: "Any USB drive works. Pair it, start a session, put it somewhere that costs you a walk.",
  },
  graphic: {
    kind: "compare",
    title: "Five kinds of lock, and how each one fails",
    caption: "Toggles, delay locks, password locks, hard locks and a physical key compared on flexibility, friction at the moment of the urge, and how each fails.",
    fromTable: "Five kinds of lock, three questions",
    rows: [
      "Toggle or extension",
      "Delay or typed challenge (wait 60s, retype a string)",
      "Password or restart lock",
      "Hard lock (timer can't be cancelled, forced plan)",
      "Physical key (another room)",
    ],
  },
  related: [
    "physical-website-blocker",
    "cold-turkey-vs-freedom-vs-focusme",
    "website-blocker-you-cant-turn-off",
  ],
};
