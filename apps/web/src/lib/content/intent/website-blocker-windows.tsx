import Link from "next/link";
import { FREE_BLOCKED_SITE_LIMIT } from "@talysman/product";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * Platform page. What makes it more than the homepage with "Windows" pasted in is the Windows-
 * specific enforcement detail — the service account, SCM recovery, DNS and SNI interception, the
 * firewall backstop, the NSIS uninstall guard — which is exactly what a Windows user who has
 * killed a blocker in Task Manager before wants to read.
 */
export const websiteBlockerWindows: IntentPage = {
  slug: "website-blocker-windows",
  group: "use-cases",
  summary: "A Windows 10 and 11 blocker for sites and apps, enforced by a system service and ended early only with a USB key.",
  lastReviewed: "2026-10-07",
  intent: "website blocker windows / good app blocker for focused work on windows",
  eyebrow: "Website blocker for Windows",
  title: "Website blocker for Windows that uses a physical key",
  metaTitle: "Website Blocker for Windows That Uses a Physical Key",
  metaDescription:
    "Block distracting websites and apps on Windows and move the session's early-exit control onto a paired USB key.",
  lede: (
    <>
      Task Manager has ended more focus sessions than any distraction. On Windows, the blocker has
      to survive it.
    </>
  ),
  answer: (
    <>
      <p>
        {config.app.name} is a website and app blocker for Windows 10 and 11 that runs as a Windows
        system service, so closing the app or ending it in Task Manager doesn&apos;t lift the block.
        Ending a focus session early requires a paired USB drive to be plugged in — any drive you
        already own.
      </p>
      <p>
        It blocks sites in every browser at the network level, adds Chrome and Firefox extensions on
        top, and blocks desktop apps like Discord and Steam with Pro.
      </p>
    </>
  ),
  sections: [
    {
      kind: "table",
      title: "What happens when you try to get out on Windows",
      columns: ["You try", "What happens"],
      rows: [
        ["Close the Talysman window", "Nothing. The window is a remote control; the service does the blocking."],
        [
          "End the service in Task Manager",
          "Windows restarts it in about a second, and Windows Firewall rules hold the line in between.",
        ],
        ["Stop it with sc stop as a standard user", "Denied — standard users can't control the service."],
        ["Reboot", "The service starts with Windows and the session comes back intact."],
        ["Uninstall", "The uninstaller checks first and refuses during focus unless a paired key is plugged in."],
        ["Change DNS or use DNS-over-HTTPS", "DNS is intercepted and known encrypted-DNS routes are blocked."],
        ["Use Edge or another browser", "Blocking runs below the browser. With Strict Mode on, browsers without the extension are closed."],
        ["Click End session", "The service checks for your paired USB key. Not there, no unlock."],
      ],
    },
    {
      kind: "demo",
      title: "The Windows workaround list, exhausted",
      beats: [
        {
          label: "Ctrl+Shift+Esc",
          body: "You find Talysman in Task Manager and end it. The block page is still there. The service came back before you switched windows.",
        },
        {
          label: "Restart",
          body: "You restart. Windows boots, the service starts, focus is still on.",
        },
        {
          label: "Settings → Apps",
          body: "You try to uninstall. It refuses: focus is active and no key is present.",
        },
        {
          label: "The key",
          body: "Which is in a drawer two rooms away. By now you've spent three minutes on the workaround and the urge has worn off.",
        },
      ],
      media: {
        label: "Windows: Task Manager, restart, uninstall — all refused",
        note: "Screen recording on Windows 11: end task → service returns → restart → session intact → uninstall refused → cut to the drive in a drawer.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "cards",
      title: "Built for Windows",
      cards: [
        {
          title: "A real Windows service",
          body: "Runs as LocalSystem with automatic restart, not as a tray app you can close.",
        },
        {
          title: "Blocks in every browser",
          body: "DNS and TLS-hostname filtering below the browser, plus Chrome and Firefox extensions.",
        },
        {
          title: "Desktop apps too",
          body: "Discord, Steam, games and chat clients are closed while blocked (Pro).",
        },
        {
          title: "Any USB drive is the key",
          body: "Paired by the serial or volume ID the drive already reports; nothing is normally written to it.",
        },
      ],
    },
    {
      kind: "honesty",
      title: "Limits",
      body: (
        <p>
          An administrator can still boot into Safe Mode or disable services, and a VPN can route
          around a host-based filter. {config.app.name} removes the five-second exits; it
          doesn&apos;t make your own PC unbreakable.
        </p>
      ),
    },
    {
      kind: "faq",
      items: [
        {
          q: "Which Windows versions are supported?",
          a: <p>Windows 10 and 11, 64-bit.</p>,
        },
        {
          q: "Is it free on Windows?",
          a: (
            <p>
              Yes — {FREE_BLOCKED_SITE_LIMIT} sites, unlimited manual sessions and the key
              requirement, with no card. App blocking and schedules are{" "}
              <Link href="/pricing">Pro</Link>.
            </p>
          ),
        },
        {
          q: "Does it work on Mac and Linux too?",
          a: (
            <p>
              Yes: <Link href="/website-blocker-mac">macOS</Link> and{" "}
              <Link href="/website-blocker-linux">Debian/Ubuntu Linux</Link>. One USB drive can be
              paired on all of them.
            </p>
          ),
        },
      ],
    },
  ],
  cta: {
    heading: "Install it on Windows in two minutes",
    body: "Download, pair a drive, start a session, and try Task Manager.",
  },
  graphic: {
    kind: "ladder",
    title: "Getting out on Windows: every route",
    caption: "What happens on Windows when you close Talysman, end its service, reboot, uninstall, change DNS, switch browsers or click End session without the key.",
    fromTable: "What happens when you try to get out on Windows",
    rows: {
      "Close the Talysman window": "blocked",
      "End the service in Task Manager": "blocked",
      "Stop it with sc stop as a standard user": "blocked",
      "Reboot": "blocked",
      "Uninstall": "blocked",
      "Change DNS or use DNS-over-HTTPS": "blocked",
      "Use Edge or another browser": "blocked",
      "Click End session": "blocked",
    },
  },
  related: ["app-blocker-pc", "website-blocker-you-cant-turn-off", "website-blocker-mac", "website-blocker-linux"],
};
