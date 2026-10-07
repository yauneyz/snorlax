import Link from "next/link";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * Persona page for remote workers. At home there is no office to make the boundary for you; the
 * page frames the USB key as that boundary — a physical object that says "working" — and answers
 * the Freedom-vs-Talysman question for this persona directly in the FAQ.
 */
export const focusAppRemoteWork: IntentPage = {
  slug: "focus-app-remote-work",
  group: "use-cases",
  summary: "A physical boundary between focused work and the internet when you work from home.",
  lastReviewed: "2026-10-07",
  intent:
    "focus app for remote workers / how can a remote worker stop bypassing their own website blocker / freedom vs talysman for a remote worker",
  eyebrow: "Focus app for remote work",
  title: "Focus app for remote workers: create a physical boundary for work",
  metaTitle: "Focus App for Remote Workers: Create a Physical Boundary for Work",
  metaDescription:
    "Use a USB-key blocker to create a stronger boundary between focused work and online distraction at home.",
  lede: <>The office used to be the boundary. At home, the only thing between you and the feed is you.</>,
  answer: (
    <>
      <p>
        Remote workers stop bypassing their own website blocker by moving the off switch off the
        desk. {config.app.name} blocks distracting sites and apps on your work computer, and ending a
        focus session early needs a paired USB key plugged in. Keep the key in another room during
        work hours and the boundary the office used to provide comes back.
      </p>
      <p>Work tools you don&apos;t put on the list — Slack, email, video calls — keep working.</p>
    </>
  ),
  sections: [
    {
      kind: "steps",
      title: "A remote-work setup",
      steps: [
        { title: "Schedule your focus blocks", body: "Recurring windows start themselves, even if you forget (Pro)." },
        { title: "Block the drift, not the job", body: "Feeds and news blocked; LinkedIn and X kept with feeds hidden if you need them for work." },
        { title: "Give the key a home", body: "A hook by the door, a drawer in another room. When it's there, you're working." },
        { title: "End the day with the key", body: "Plug it in when you're done. That's the commute." },
      ],
    },
    {
      kind: "demo",
      title: "A working-from-home afternoon",
      beats: [
        { label: "13:30", body: "Post-lunch slump. You open a news site. Blocked." },
        { label: "13:31", body: "You open Talysman. “Insert your key to turn off the blocker.” The key is on the hook by the front door." },
        { label: "13:32", body: "You get water instead and go back to the doc." },
        { label: "17:30", body: "You fetch the key and end the session. Work is over." },
      ],
      media: {
        label: "The key as the end of the workday",
        note: "Screen recording + live action: blocked news site → refusal → key on a hook by the door → evening: key plugged in, session ends.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "faq",
      items: [
        {
          q: "Freedom vs Talysman for a remote worker?",
          a: (
            <p>
              Freedom if your phone is the main problem — it blocks across devices. {config.app.name}{" "}
              if your work computer is, and you keep ending sessions early.{" "}
              <Link href="/freedom-alternative">Full comparison</Link>.
            </p>
          ),
        },
        { q: "Will it block Slack or Zoom?", a: <p>Only if you add them. A blocklist only blocks what&apos;s on it.</p> },
        { q: "Can I use it on a work laptop?", a: <p>It needs admin rights to install its service. Check your employer&apos;s policy.</p> },
      ],
    },
  ],
  cta: { heading: "Bring back the boundary", body: "Pair a drive, schedule your focus hours, and give the key a home." },
  graphic: {
    kind: "timeline",
    title: "A working-from-home day with the key as the boundary",
    caption: "A remote workday with Talysman: focus runs through working hours, a news site is blocked after lunch, ending early is refused with the key by the door, and plugging it in at 17:30 ends the day.",
    from: 8.5,
    to: 18,
    window: { from: 9, to: 17.5, label: "Working hours · key on the hook by the door" },
    events: [
      { at: 9, label: "Focus starts on schedule", tone: "open" },
      { at: 13.5, label: "Post-lunch: news site blocked", tone: "blocked" },
      { at: 13.52, label: "Turn off? The key is by the door", tone: "blocked" },
      { at: 17.5, label: "Key plugged in. Work is over", tone: "open" },
    ],
  },
  related: ["stop-disabling-website-blocker", "freedom-alternative", "block-social-media-on-computer", "deep-work-blocker"],
};
