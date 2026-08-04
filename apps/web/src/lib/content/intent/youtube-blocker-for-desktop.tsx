import Link from "next/link";
import { FREE_BLOCKED_SITE_LIMIT, PRO_TRIAL_DAYS } from "@talysman/product";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * The one page in the set with a purely practical intent — "block YouTube on my computer" — so
 * it leads with instructions and keeps the argument short. The domain-level limitation is
 * disclosed on the page rather than buried in an FAQ, because "can I still watch tutorials" is
 * the first thing this searcher wants to know and finding out later feels like a bait.
 */
export const youtubeBlockerForDesktop: IntentPage = {
  slug: "youtube-blocker-for-desktop",
  intent: "youtube blocker for desktop",
  eyebrow: "YouTube blocker for desktop",
  title: "Block YouTube on your computer, and mean it",
  metaTitle: `YouTube Blocker for Desktop — Windows, macOS and Linux | ${config.app.name}`,
  metaDescription:
    "Block YouTube on Windows, macOS and Linux in about two minutes. Talysman blocks the site in Chrome and Firefox and the desktop apps too — and unblocking early needs a USB key you left in another room.",
  lede: (
    <>
      Blocking YouTube is easy. Every extension does it. The part that decides whether your
      afternoon survives is what happens when you go to unblock it.
    </>
  ),
  answer: (
    <>
      <p>
        {config.app.name} blocks youtube.com across Chrome and Firefox on Windows, macOS and Linux,
        blocks the desktop apps that would route around it, and closes browsers that can&apos;t
        enforce the list instead of leaving them open as the obvious workaround. Setup takes about
        two minutes.
      </p>
      <p>
        What makes it hold is the unblock: turning focus off early requires a paired USB drive to be
        plugged into the computer. Leave the drive in another room and YouTube stays gone until the
        session ends — not until you change your mind. YouTube plus four more sites fits in the free
        tier, with no card.
      </p>
    </>
  ),
  sections: [
    {
      kind: "steps",
      title: "Block YouTube in about two minutes",
      steps: [
        {
          title: "Install and pair a drive",
          body: (
            <>
              <Link href="/download">Download {config.app.name}</Link> for your platform and add the
              Chrome or Firefox extension. Plug in any USB drive you own and pair it — that drive is
              now the key for this computer.
            </>
          ),
        },
        {
          title: "Add youtube.com to the blocklist",
          body: (
            <>
              Add the domain and anything that would stand in for it later that afternoon —
              reddit.com, x.com, whatever your particular version is. Five sites are free.
            </>
          ),
        },
        {
          title: "Start a session, then unplug the key",
          body: (
            <>
              Set a length and start. Take the drive out of the machine and leave it somewhere that
              costs you a walk. That step is not optional; it&apos;s the entire mechanism.
            </>
          ),
        },
      ],
    },
    {
      kind: "demo",
      title: "What blocked actually looks like",
      lede: "Four things happen, and only the last one is unusual.",
      beats: [
        {
          label: "In the browser",
          body: "youtube.com stops loading in Chrome and Firefox. The block page doesn't even receive which address was requested — your blocklist is turned into browser-native rules and the extension never sees your browsing.",
        },
        {
          label: "In other browsers",
          body: "A browser without the extension gets closed during a locked session rather than left running as the unguarded door.",
        },
        {
          label: "In desktop apps",
          body: "The apps on your list — a desktop client, Discord, Steam — are blocked as apps, so the distraction can't just change shape.",
        },
        {
          label: "When you try to undo it",
          body: "You click End session. The service checks for your paired key, finds nothing plugged in, and declines. The drive is in the kitchen. You go back to work.",
        },
      ],
      media: {
        label: "YouTube blocked in Chrome, then the failed unblock",
        note: "Screen recording: youtube.com → block page → Talysman window → End session → “Insert your key to end early”, red indicator → cut to the drive in another room.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "prose",
      title: "About watching YouTube for work",
      body: (
        <>
          <p>
            Blocking is domain-level. youtube.com is either blocked or it isn&apos;t — there&apos;s
            no way to permit one tutorial and refuse the homepage, and any tool that claims
            otherwise is deciding for you what counts as research.
          </p>
          <p>
            If your work genuinely needs a narrow set of sites, the better fit is allow-only mode:
            block everything, then list the handful of tools the job actually requires. It&apos;s a
            harder setting than a blocklist, and it&apos;s the one that turns a personal computer
            into a work computer without buying a second computer.
          </p>
        </>
      ),
    },
    {
      kind: "cards",
      title: "The parts that matter after week one",
      lede: "Anyone can block YouTube once. These are the things that decide whether it's still blocked in March.",
      cards: [
        {
          title: "Recurring windows arm themselves",
          body: "Schedule your two best hours and the block starts without you — even if the app is closed and you never remembered to press start. That's Pro.",
        },
        {
          title: "Quitting the app changes nothing",
          body: "Enforcement is a privileged background service. Closing the window, killing the process, or rebooting all leave the session running.",
        },
        {
          title: "Uninstalling is key-gated",
          body: "The uninstaller refuses to remove the service mid-session unless a paired key is present, so “uninstall” isn't the unblock button.",
        },
        {
          title: "Your history stays yours",
          body: "The extension never receives the URLs you visit, your history, page content, or search terms, and makes no requests of its own.",
        },
      ],
    },
    {
      kind: "faq",
      items: [
        {
          q: "Does it block the YouTube desktop app too?",
          a: (
            <p>
              App blocking covers desktop applications you add to the list, so a desktop client
              isn&apos;t a way around the site block. App blocking is a Pro feature; website
              blocking is free.
            </p>
          ),
        },
        {
          q: "Can I block YouTube but allow one channel or one video?",
          a: (
            <p>
              No — blocking works at the domain level, so youtube.com is blocked or it isn&apos;t.
              If you need a small set of work tools and nothing else, use allow-only mode instead.
            </p>
          ),
        },
        {
          q: "Which browsers are supported?",
          a: (
            <p>
              Chrome and Firefox have extensions. During a locked session, any browser without one
              is closed rather than left as an open door, so an un-extended browser isn&apos;t a
              workaround — it&apos;s just a browser you can&apos;t use right now.
            </p>
          ),
        },
        {
          q: "Is blocking YouTube free?",
          a: (
            <p>
              Yes. Free covers {FREE_BLOCKED_SITE_LIMIT} blocked websites, unlimited manual sessions
              and the key requirement, with no card. Recurring schedules and desktop app blocking
              are Pro, free for {PRO_TRIAL_DAYS} days — <Link href="/pricing">see pricing</Link>.
            </p>
          ),
        },
      ],
    },
  ],
  cta: {
    heading: "Block YouTube for one real workday",
    body: "Pair a drive, add the domain, unplug the key, and see how the afternoon goes.",
  },
  related: [
    "website-blocker-you-cant-disable",
    "how-to-stop-disabling-website-blockers",
    "physical-website-blocker",
  ],
};
