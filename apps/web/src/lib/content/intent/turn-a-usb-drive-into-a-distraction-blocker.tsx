import Link from "next/link";
import { FREE_BLOCKED_SITE_LIMIT, PRO_TRIAL_DAYS } from "@talysman/product";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * This searcher is halfway to building it themselves. The page has to answer the DIY questions
 * honestly and early — what gets written to the drive, what happens if it's lost, whether it
 * still works as a normal drive — because anyone technical enough to search this is technical
 * enough to be suspicious of a product that dodges them.
 */
export const turnAUsbDriveIntoADistractionBlocker: IntentPage = {
  slug: "turn-a-usb-drive-into-a-distraction-blocker",
  intent: "turn a USB drive into a distraction blocker",
  eyebrow: "USB drive as a focus key",
  title: "Turn a USB drive into a distraction blocker",
  metaTitle: `Turn a USB Drive Into a Distraction Blocker | ${config.app.name}`,
  metaDescription:
    "Pair any USB drive you already own and it becomes the physical key to your focus sessions: while it's unplugged, blocked sites and apps stay blocked. Nothing to buy, and the drive keeps working as a drive.",
  lede: (
    <>
      The drive in your desk drawer is already the hardware. It just needs something on the
      computer that refuses to unblock while it&apos;s missing.
    </>
  ),
  answer: (
    <>
      <p>
        Install {config.app.name}, pair a USB drive, and that drive becomes the key to your focus
        sessions. While it isn&apos;t plugged in, blocked websites and desktop apps stay blocked —
        ending a session early requires the background service to physically see a paired drive on
        the machine. Take the drive to another room and there is no off switch in the room
        you&apos;re in.
      </p>
      <p>
        Any standard drive works. Nothing to buy, nothing to wait for, and the drive keeps working
        as an ordinary drive — you can still put files on it.
      </p>
    </>
  ),
  sections: [
    {
      kind: "steps",
      title: "Four steps, once",
      steps: [
        {
          title: "Pick a drive you won't need in the next hour",
          body: (
            <>
              Any standard USB stick. Capacity is irrelevant — nothing meaningful gets stored on it.
              The one property that matters is that you&apos;re willing to leave it in another room
              for a couple of hours at a time.
            </>
          ),
        },
        {
          title: "Pair it",
          body: (
            <>
              <Link href="/download">Install {config.app.name}</Link>, plug the drive in, and pick
              it from the list of removable drives. It&apos;s now a key for this computer. Pair a
              second drive while you&apos;re there — any paired drive unlocks, so a spare is what
              turns a lost drive into a shrug.
            </>
          ),
        },
        {
          title: "Choose what the key protects",
          body: (
            <>
              Add the sites that take your afternoons, add the desktop apps that pull you away, or
              flip to allow-only and permit just the tools the work needs. Start a session now, or
              schedule the same hours every week.
            </>
          ),
        },
        {
          title: "Unplug it and walk away",
          body: (
            <>
              Another room, a drawer downstairs, the glovebox. This is the step that does all the
              work, and it&apos;s the step people skip. A key sitting next to the keyboard is a
              one-click off switch with extra ceremony.
            </>
          ),
        },
      ],
    },
    {
      kind: "demo",
      title: "What the drive actually does",
      lede: "The check happens at the moment you ask to unlock — not before, and never on a timer.",
      beats: [
        {
          label: "Plugged in",
          body: "Talysman shows a green key indicator. You can start sessions, change the blocklist, and end focus whenever you like. Normal drive behaviour otherwise: mount it, copy files to it, eject it.",
        },
        {
          label: "Session starts",
          body: "Blocking is handed to a privileged background service. From here on the app window is just a remote control for something that outranks it.",
        },
        {
          label: "Unplugged",
          body: "The indicator goes red. Blocked stays blocked. Nothing about the session changes — the drive isn't holding any state, it's just absent.",
        },
        {
          label: "You try to end early",
          body: "The service looks for a drive whose identifier matches one you paired. There isn't one, so the answer is no. Quitting the app, killing the service, rebooting and uninstalling all leave the session running.",
        },
        {
          label: "Plugged back in",
          body: "Green again. You can end the session. The check is live every time — there's no grace period and no “trusted for 15 minutes”.",
        },
      ],
      media: {
        label: "Pairing a drive, then the red indicator with it unplugged",
        note: "Screen recording: the removable-drive picker → green key indicator → drive pulled from the port → indicator turns red → End session refused.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "cards",
      title: "What's on the drive (almost nothing)",
      lede: "Worth being precise about, because a key that holds your data is a key you can't afford to lose.",
      cards: [
        {
          title: "Normally: nothing at all",
          body: `${config.app.name} identifies the drive by the hardware serial or volume ID it already reports. In the usual case pairing writes nothing to it.`,
        },
        {
          title: "The exception: one marker file",
          body: "A drive that reports no usable identifier gets a single small random marker file at pairing, so its presence can still be detected. That's the entire footprint.",
        },
        {
          title: "Never your data",
          body: "Your files, your blocklist and your account never touch the drive. It doesn't hold your session either — the background service does.",
        },
        {
          title: "Still a normal drive",
          body: "Keep using it for files. It mounts, copies and ejects exactly like it did before you paired it.",
        },
        {
          title: "As many keys as you want",
          body: "Pair spares and keep one somewhere safe. Any paired drive unlocks, so losing one is an inconvenience rather than a lockout.",
        },
        {
          title: "One drive, several computers",
          body: "Pair the same drive on your laptop and your desktop. Each machine keeps its own list of paired keys.",
        },
      ],
    },
    {
      kind: "prose",
      title: "Why you can't quite build this yourself",
      body: (
        <>
          <p>
            Plenty of people have written the script version: watch for a volume to mount, flip
            some hosts-file entries when it disappears. It works for about a week, and then you
            remember that you wrote it, that you have administrator rights, and that reverting it
            takes one command you know by heart.
          </p>
          <p>
            The hard part was never detecting the drive. It&apos;s that the enforcement has to
            outlive your attempts to end it: a privileged service that restarts when killed, comes
            back after a reboot with the session intact, an uninstaller that refuses to run
            mid-session without a key, browser extensions that turn your list into browser-native
            rules, and browsers without one getting closed instead of left standing open. That&apos;s
            the part that takes a product rather than an afternoon.
          </p>
        </>
      ),
    },
    {
      kind: "honesty",
      title: "What it can't do",
      body: (
        <>
          <p>
            It can&apos;t help if the drive stays plugged in. The mechanism is the distance, and the
            distance only exists if you create it.
          </p>
          <p>
            And with administrator rights on your own machine, a determined person can eventually
            force past any blocker, this one included. The honest claim is that the cheap exits are
            gone — not that there are none.
          </p>
        </>
      ),
    },
    {
      kind: "faq",
      items: [
        {
          q: "Will any USB drive work?",
          a: (
            <p>
              A standard USB drive, yes. {config.app.name} lists the removable drives it can see and
              you pick one. Drives that report no usable identifier still work — pairing writes one
              small marker file so presence can be detected.
            </p>
          ),
        },
        {
          q: "Do I have to reformat or dedicate the drive?",
          a: (
            <p>
              No. Keep your files on it and keep using it. Pairing doesn&apos;t erase anything and
              doesn&apos;t change how the drive behaves.
            </p>
          ),
        },
        {
          q: "What if I lose it mid-session?",
          a: (
            <p>
              Any other paired drive unlocks, which is the argument for pairing a spare today. If
              you have no spare, the session still ends on its own at the time you set — a session
              is a session, not a permanent state.
            </p>
          ),
        },
        {
          q: "Can someone else hold my key?",
          a: (
            <p>
              Sure. It&apos;s a physical object; giving it to someone in another building is a
              perfectly valid configuration, and a stronger one than most software locks. Just
              remember that you can also pair a second drive, which quietly undoes the arrangement
              — so pair the spare in front of them or not at all.
            </p>
          ),
        },
        {
          q: "What does it cost?",
          a: (
            <p>
              The mechanism is free: {FREE_BLOCKED_SITE_LIMIT} blocked websites, unlimited manual
              sessions, and the key requirement, with no card. Pro adds unlimited sites, desktop app
              blocking, recurring schedules and unlimited profiles, free for {PRO_TRIAL_DAYS} days.{" "}
              <Link href="/pricing">See pricing</Link>.
            </p>
          ),
        },
      ],
    },
  ],
  cta: {
    heading: "Go find a drive you're not using",
    body: "Pair it, block the sites that take your afternoons, and leave it in the kitchen.",
  },
  related: [
    "physical-website-blocker",
    "brick-for-desktop",
    "how-to-stop-disabling-website-blockers",
  ],
};
