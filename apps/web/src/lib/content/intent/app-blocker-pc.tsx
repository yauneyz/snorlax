import Link from "next/link";
import { PRO_TRIAL_DAYS } from "@talysman/product";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * App blocking is Pro, and this page says so in the answer rather than the FAQ — someone
 * searching "app blocker for PC" who finds out at checkout feels baited.
 */
export const appBlockerPc: IntentPage = {
  slug: "app-blocker-pc",
  group: "use-cases",
  summary: "Block Discord, Steam and other desktop apps during deep work, ended early only with a USB key.",
  lastReviewed: "2026-10-07",
  intent: "app blocker for pc / good app blocker for focused work on windows",
  eyebrow: "App blocker for PC",
  title: "App blocker for PC for deep work",
  metaTitle: `App Blocker for PC for Deep Work | ${config.app.name}`,
  metaDescription:
    "Block distracting desktop apps during focused work and make ending the session a deliberate decision.",
  lede: <>Close the browser and Discord is still there. On a PC, half the distractions aren&apos;t websites.</>,
  answer: (
    <>
      <p>
        {config.app.name} is an app blocker for PC that closes distracting desktop apps — Discord,
        Steam, game launchers, chat clients — during a focus session, alongside the websites you
        block. Ending the session early requires a paired USB key plugged into the computer, so
        reopening the app isn&apos;t one click away.
      </p>
      <p>
        App blocking is part of Pro (free for {PRO_TRIAL_DAYS} days). It runs on Windows, and on
        macOS and Linux too.
      </p>
    </>
  ),
  sections: [
    {
      kind: "steps",
      title: "Block an app in three steps",
      steps: [
        { title: "Add the app to your list", body: "Pick it from the apps on your computer. Add the website version too, so it can't change shape." },
        { title: "Start a session", body: "Or schedule one: recurring windows start without you, even if Talysman is closed." },
        { title: "Unplug the key", body: "Put the paired USB drive somewhere that costs you a walk." },
      ],
    },
    {
      kind: "demo",
      title: "What it looks like",
      beats: [
        { label: "Launch", body: "You open Discord out of habit. It closes within about a second." },
        { label: "Again", body: "You open it again. It closes again. The service checks the process list continuously during focus." },
        { label: "The browser", body: "You try discord.com. Also blocked, because you added it too." },
        { label: "The off switch", body: "“Insert your key to turn off the blocker.” The key is downstairs." },
      ],
      media: {
        label: "Discord closing during focus",
        note: "Screen recording on Windows: launch Discord → it closes → launch again → closes → discord.com blocked → End session refusal.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "honesty",
      title: "How app blocking works, and its limit",
      body: (
        <p>
          Blocked apps are closed when they start, not prevented from launching, so you may see a
          window flash before it goes. A renamed copy of an app is a different app. It&apos;s built to
          beat the habit of opening something, not a deliberate effort to smuggle it past.
        </p>
      ),
    },
    {
      kind: "faq",
      items: [
        { q: "Is app blocking free?", a: <p>No — it&apos;s Pro. Website blocking and the key are free. <Link href="/pricing">See pricing</Link>.</p> },
        { q: "Can I block games?", a: <p>Yes. Games and launchers like Steam are apps; add them to the list.</p> },
        {
          q: "Does it work on Windows 10 and 11?",
          a: <p>Yes. See <Link href="/website-blocker-windows">the Windows page</Link> for how it holds up against Task Manager.</p>,
        },
      ],
    },
  ],
  cta: { heading: "Block the apps, not just the tabs", body: `Try Pro free for ${PRO_TRIAL_DAYS} days with a USB drive you already own.` },
  graphic: {
    kind: "states",
    title: "What happens when a blocked app opens during focus",
    caption: "Opening a blocked app like Discord during a Talysman session: it closes, closes again, its website is blocked too, and turning focus off needs the USB key.",
    states: [
      { label: "Launch", text: "You open Discord out of habit.", tone: "plain" },
      { label: "Closed", text: "It closes within about a second.", tone: "blocked" },
      { label: "Again", text: "Closed again. The process list is checked all session.", tone: "blocked" },
      { label: "discord.com", text: "Blocked too, once you add the site alongside the app.", tone: "blocked" },
      { label: "Turn off", text: "Needs the paired USB key — which is downstairs.", tone: "blocked" },
    ],
    notes: [
      "App blocking is Pro. Website blocking and the key are free.",
      "Games and launchers like Steam are apps: add them to the list the same way.",
    ],
  },
  related: ["website-blocker-windows", "deep-work-blocker", "focus-app-developers"],
};
