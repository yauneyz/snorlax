import Link from "next/link";
import { PRO_TRIAL_DAYS } from "@talysman/product";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * How-to with a template. Deep-work searchers already know the book; what they lack is a setup
 * that survives the third week. So: a concrete template (blocklist, schedule, key placement) and
 * the argument for why a recoverable exit protects more hours than an unbreakable one.
 */
export const deepWorkBlocker: IntentPage = {
  slug: "deep-work-blocker",
  group: "use-cases",
  summary: "A deep-work session template that's hard to abandon on impulse but still under your control.",
  lastReviewed: "2026-10-07",
  intent: "deep work blocker / best distraction blocker for desktop computers",
  eyebrow: "Deep work blocker",
  title: "Deep work distraction blocker: protect the focus window",
  metaTitle: "Deep Work Distraction Blocker: Protect the Focus Window",
  metaDescription:
    "Build a distraction-free work session that is difficult to abandon impulsively but still under your deliberate control.",
  lede: <>Deep work is mostly about the first forty minutes not getting interrupted by you.</>,
  answer: (
    <>
      <p>
        A good deep-work blocker does three things: it starts the focus window without relying on
        willpower, blocks the sites and apps you drift to, and makes leaving the window early a
        deliberate act rather than a reflex. {config.app.name} does the last part with a physical
        key — ending a session early needs a paired USB drive plugged in, and you leave the drive in
        another room.
      </p>
    </>
  ),
  sections: [
    {
      kind: "steps",
      title: "A deep-work template",
      lede: "Copy this, then adjust after a week.",
      steps: [
        { title: "Pick the window", body: "Your best two to three hours, the same time every weekday. Schedule it so it starts without you (Pro)." },
        { title: "Choose allow-only, not block", body: "For real deep work, block everything and allow the handful of tools the task needs: your editor's docs, the repo, the one reference site." },
        { title: "Block the apps", body: "Chat, email client, Discord, games. The tab isn't the only door (Pro)." },
        { title: "Place the key", body: "Somewhere that takes over a minute to reach. Another floor beats another drawer." },
        { title: "Lock the hours you'll negotiate with", body: "Mark the window locked and even the key won't end it early. Only for hours you're sure about." },
      ],
    },
    {
      kind: "prose",
      title: "Why an exit protects more hours than no exit",
      body: (
        <>
          <p>
            Unbreakable locks look like the serious option. In practice people respond to them by
            locking less: a shorter window, or none on days that might go wrong. A window you can
            leave — deliberately, on your feet — is a window you&apos;ll actually start every
            morning.
          </p>
          <p>
            That&apos;s the trade-off <Link href="/digital-lock-vs-physical-friction">digital
            locks vs physical friction</Link> covers in detail, and why the{" "}
            <Link href="/cold-turkey-vs-freedom-vs-focusme">strict blockers</Link> suit some people
            better than others.
          </p>
        </>
      ),
    },
    {
      kind: "demo",
      title: "A morning in the window",
      beats: [
        { label: "08:58", body: "The schedule arms focus. Everything except the editor, docs and repo is blocked." },
        { label: "09:41", body: "The problem gets hard. You reach for the browser and get a block page." },
        { label: "09:42", body: "End session. “Insert your key to turn off the blocker.” The key is upstairs." },
        { label: "11:00", body: "The window closes on its own. You got the hard part done." },
      ],
      media: {
        label: "A scheduled deep-work window from start to finish",
        note: "Time-lapse: schedule arms focus → block page → refusal dialog → window ends.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "faq",
      items: [
        { q: "Is scheduling free?", a: <p>Recurring schedules are Pro, free for {PRO_TRIAL_DAYS} days. Manual sessions are free.</p> },
        { q: "What if something urgent comes up mid-window?", a: <p>Go get the key. If it&apos;s lost, each computer has five lifetime emergency unlocks.</p> },
      ],
    },
  ],
  cta: { heading: "Set up your first deep-work window", body: "Pair a drive, set the window, and put the key upstairs." },
  graphic: {
    kind: "timeline",
    title: "A deep-work morning, start to finish",
    caption: "A scheduled 9:00–11:00 deep-work window in Talysman: the schedule arms focus, a distraction is blocked, ending early is refused without the key, and the window closes on its own.",
    from: 8.5,
    to: 11.5,
    window: { from: 9, to: 11, label: "Scheduled deep-work window" },
    events: [
      { at: 8.97, label: "The schedule arms focus", tone: "open" },
      { at: 9.68, label: "A reach for the browser: block page", tone: "blocked" },
      { at: 9.7, label: "End early? The key is upstairs", tone: "blocked" },
      { at: 11, label: "The window closes on its own", tone: "open" },
    ],
  },
  related: ["cold-turkey-vs-freedom-vs-focusme", "focus-app-developers", "focus-app-writers", "app-blocker-pc"],
};
