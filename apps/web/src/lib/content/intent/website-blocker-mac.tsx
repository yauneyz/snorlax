import Link from "next/link";
import { FREE_BLOCKED_SITE_LIMIT } from "@talysman/product";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * Platform page for macOS. Kept strictly to what the macOS backend does today — a root
 * LaunchDaemon with KeepAlive, pf plus a managed hosts block, process termination for apps.
 * Deliberately makes no uninstall claim: macOS has no installer hook running the key check the
 * way Windows (NSIS) and Linux (dpkg prerm) do.
 */
export const websiteBlockerMac: IntentPage = {
  slug: "website-blocker-mac",
  group: "use-cases",
  summary: "A blocker for Apple Silicon and Intel Macs that you can't Cmd-Q your way out of.",
  lastReviewed: "2026-10-07",
  intent: "website blocker mac",
  eyebrow: "Website blocker for Mac",
  title: "Website blocker for Mac that's hard to quit on impulse",
  metaTitle: "Website Blocker for Mac That's Hard to Quit on Impulse",
  metaDescription:
    "Protect focused work on Intel and Apple Silicon Macs with a distraction blocker tied to a physical USB key.",
  lede: <>Cmd-Q is the fastest unblock button ever made. On a Mac, the blocker can&apos;t live in the app you quit.</>,
  answer: (
    <>
      <p>
        {config.app.name} is a Mac website and app blocker for Apple Silicon and Intel that enforces
        from a background system daemon rather than the app window, so Cmd-Q, Force Quit and
        restarting don&apos;t end a focus session. Ending one early requires a paired USB drive to
        be plugged in.
      </p>
      <p>
        It blocks sites in Safari, Chrome, Firefox and every other browser at the network level, adds
        Chrome and Firefox extensions for finer rules, and blocks desktop apps with Pro.
      </p>
    </>
  ),
  sections: [
    {
      kind: "table",
      title: "What happens when you try to get out on a Mac",
      columns: ["You try", "What happens"],
      rows: [
        ["Cmd-Q the app", "Nothing. The app is a remote control; a system daemon does the blocking."],
        ["Force Quit or kill the daemon", "launchd starts it again."],
        ["Stop it with launchctl as a standard user", "Denied — it's a root daemon."],
        ["Restart the Mac", "The daemon starts at boot and the session is still on."],
        ["Switch to Safari", "Blocking runs at the network level, below every browser. With Strict Mode on, browsers without the extension are closed."],
        ["Click End session", "The daemon checks for your paired USB key. Not there, no unlock."],
      ],
    },
    {
      kind: "demo",
      title: "On a Mac, mid-afternoon",
      beats: [
        { label: "Cmd-Q", body: "You quit Talysman. The site is still blocked." },
        { label: "Safari", body: "You try another browser. Same block — it isn't an extension trick." },
        { label: "End session", body: "“Insert your key to turn off the blocker.” The indicator is red." },
        { label: "The key", body: "It's on the hallway shelf. You'd have to go get it. You go back to work instead." },
      ],
      media: {
        label: "macOS: quit, switch browsers, refusal",
        note: "Screen recording on macOS: Cmd-Q → site still blocked → Safari also blocked → End session refusal → cut to the drive on a shelf.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "honesty",
      title: "Limits on macOS",
      body: (
        <>
          <p>
            The macOS version blocks with the system packet filter and a managed hosts block, and
            closes blocked apps. It doesn&apos;t yet use Apple&apos;s Network Extension or Endpoint
            Security frameworks, which need special entitlements from Apple. An administrator who
            knows where to look can remove it. The aim, as everywhere, is to remove the quick exits.
          </p>
        </>
      ),
    },
    {
      kind: "faq",
      items: [
        { q: "Does it work on Apple Silicon?", a: <p>Yes — Apple Silicon and Intel Macs.</p> },
        {
          q: "Is it free on Mac?",
          a: (
            <p>
              Yes — {FREE_BLOCKED_SITE_LIMIT} sites, unlimited manual sessions and the key
              requirement, no card. App blocking and schedules are <Link href="/pricing">Pro</Link>.
            </p>
          ),
        },
        {
          q: "Can one key unlock my Mac and my Windows PC?",
          a: <p>Yes. Pair the same drive on each computer; each keeps its own list of paired keys.</p>,
        },
      ],
    },
  ],
  cta: {
    heading: "Try it on your Mac",
    body: "Download, pair a drive, start a session, and try Cmd-Q.",
  },
  graphic: {
    kind: "ladder",
    title: "Getting out on a Mac: every route",
    caption: "What happens on macOS when you quit Talysman, kill its daemon, use launchctl, restart, switch to Safari or click End session without the key.",
    fromTable: "What happens when you try to get out on a Mac",
    rows: {
      "Cmd-Q the app": "blocked",
      "Force Quit or kill the daemon": "blocked",
      "Stop it with launchctl as a standard user": "blocked",
      "Restart the Mac": "blocked",
      "Switch to Safari": "blocked",
      "Click End session": "blocked",
    },
  },
  related: ["website-blocker-windows", "website-blocker-linux", "focus-app-writers", "physical-website-blocker"],
};
