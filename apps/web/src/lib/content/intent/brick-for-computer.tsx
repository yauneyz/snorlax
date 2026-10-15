import Link from "next/link";
import { FREE_BLOCKED_SITE_LIMIT } from "@talysman/product";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * Comparison page. Claims about Brick are kept to the mechanism — a physical NFC tag you tap
 * with a phone — because that is the part of their product that is stable and that the searcher
 * already knows. Feature-list claims about someone else's roadmap go stale and get us called
 * liars, so the table compares approaches and the footnote points at their site.
 */
export const brickForComputer: IntentPage = {
  slug: "brick-for-computer",
  group: "compare",
  summary: "Brick only works on phones. The closest thing for Windows, Mac and Linux.",
  lastReviewed: "2026-10-07",
  intent:
    "brick for computer / is there anything like Brick for Windows or Mac / app like Brick but for desktop",
  eyebrow: "Brick for computer",
  title: "Brick for computer? Physical distraction blocking on desktop",
  metaTitle: "Brick for Computer? Physical Distraction Blocking on Desktop",
  metaDescription:
    "Looking for Brick-style physical friction on your work computer? Compare phone-focused Brick with Talysman's USB-key desktop approach.",
  lede: (
    <>
      <p>
        If you&apos;re like me, you might already love Brick. Physically separating your
        blocker&apos;s &ldquo;unlock switch&rdquo; from your device makes a huge difference.
      </p>
      <p>
        But even if your phone is already taken care of, your work doesn&apos;t live on your phone.
        Your work lives on the computer, which has access to the whole internet. YouTube, Reddit,
        Instagram, you name it. What you really need is something like Brick but for your computer.
      </p>
      <p>
        Luckily for you, {config.app.name} does exactly that. {config.app.name} lets you use a USB
        drive as the physical &ldquo;key&rdquo; to turn off your distraction blockers. When
        it&apos;s time to focus, just put the key in another room and get to work.
      </p>
    </>
  ),
  videoAtTop: true,
  answer: (
    <>
      <p>
        Brick doesn&apos;t make a desktop or laptop version — it works with iPhones and Android
        phones only. The closest thing to Brick for a Windows PC, Mac or Linux computer is{" "}
        {config.app.name}, which uses a USB drive as the physical object instead of an NFC puck.
        This brings the &ldquo;physically separate the off switch from the device&rdquo; idea to
        your computer, where your work lives.
      </p>
      <p>
        {config.app.name} blocks distracting websites <em>and</em> desktop applications on Windows,
        macOS and Linux, and turning it off requires a paired USB drive to be physically plugged
        into the machine. Leave the drive in another room and find yourself finally able to focus.
      </p>
      <p>
        Nothing to buy and nothing to wait for in the mail — any drive in your desk drawer can be
        the key.
      </p>
    </>
  ),
  sections: [
    {
      kind: "cards",
      title: "Why a desktop blocker has more doors to close",
      lede: "A phone is a locked-down appliance. A computer is not, which is why blocking on one takes more than an app.",
      cards: [
        {
          title: "Quitting the app can't lift the block",
          body: "Enforcement runs in a privileged background service, not in the window you see. Closing Talysman changes nothing, and killing the service just makes it start again.",
        },
        {
          title: "Rebooting isn't an escape hatch",
          body: "Session state is written to protected storage and the service starts with the machine. You come back to the session you left.",
        },
        {
          title: "Uninstalling is key-gated too",
          body: "On Windows and Linux, the uninstaller refuses to remove the service while a focus session is running unless a paired key is present. On a Mac there's no uninstaller to put that check in, so this one isn't key-gated there.",
        },
        {
          title: "A second browser isn't a loophole",
          body: "Blocking also runs at the network level, below any browser. Turn on Strict Mode and browsers without the Chrome or Firefox extension are closed during focus — and Strict Mode only turns off with the key.",
        },
        {
          title: "Desktop apps count as distractions",
          body: "Discord, Steam and the rest are blocked as apps, not just as tabs. On a computer, the tab is only half the problem.",
        },
      ],
    },
    {
      kind: "honesty",
      title: "What a key can't do",
      body: (
        <>
          <p>
            Anyone with administrator rights on their own machine can eventually force their way
            past any blocker, this one included. We aren&apos;t going to pretend otherwise. The goal
            is to add enough friction to prevent you from giving in to cravings for distraction.
          </p>
          <p>
            If you can always just go get the USB to unlock, you aren&apos;t going to try to
            uninstall {config.app.name} instead. So now you&apos;re stuck having to go get the USB to
            unlock, which was the whole point of {config.app.name}. We add just the right amount of
            annoying friction to keep you on task.
          </p>
        </>
      ),
    },
    {
      kind: "faq",
      items: [
        {
          q: "Do I have to buy hardware?",
          a: (
            <p>
              No. Any USB drive you already own works. {config.app.name} identifies it by the
              hardware serial or volume ID it already reports, so normally nothing is written to the
              drive at all — and the drive keeps working as a normal drive.
            </p>
          ),
        },
        {
          q: "Can I use one drive for several computers?",
          a: (
            <p>
              Yes. Pair the same drive on each machine. Each computer keeps its own list of paired
              keys, so one drive can unlock your laptop and your desktop.
            </p>
          ),
        },
        {
          q: "What if I lose the drive?",
          a: (
            <p>
              Pair a spare now and keep it somewhere safe — any paired drive unlocks, so losing one
              isn&apos;t a lockout. You can pair as many as you like. If every drive is gone, each
              computer has five keyless emergency unlocks for life — the same idea as Brick&apos;s
              emergency unBricks — and after one you can pair a new drive.
            </p>
          ),
        },
        {
          q: "Does it block my phone too?",
          a: (
            <p>
              No. {config.app.name} is desktop-only: Windows 10 and 11, macOS on Apple Silicon and
              Intel, and Linux (Ubuntu, Debian, Fedora, Arch), with extensions for Chrome and
              Firefox. If the phone is your main problem, a phone-first tool is the honest answer
              for that half.{" "}
              <Link href="/download?from=brick-for-computer">See the downloads</Link>.
            </p>
          ),
        },
      ],
    },
  ],
  cta: {
    heading: "Put the off switch in another room",
    body: "Pair a drive you already own, start a session, and find out what happens when you try to quit.",
  },
  graphic: {
    kind: "compare",
    title: "Brick for your phone, Talysman for your computer",
    caption:
      "Brick's NFC tag and Talysman's USB key side by side: what each blocks and how each unblocks.",
    columns: ["", "Brick", `${config.app.name}`],
    rows: [
      ["Where it blocks", "Your phone", "Your Windows, macOS or Linux computer"],
      ["The physical object", "An NFC tag you buy", "A USB drive you already own"],
      ["How you unblock", "Tap the tag with your phone", "Plug the drive into the computer"],
      [
        "If the object is lost",
        "Five emergency unBricks, refreshed through support",
        "Five keyless emergency unlocks per computer, for life — and spare drives",
      ],
      [
        "Cost to start",
        "Buy the tag, wait for delivery",
        `Free for ${FREE_BLOCKED_SITE_LIMIT} blocked sites, no card`,
      ],
    ],
    highlightLast: true,
  },
  related: [
    "physical-website-blocker",
    "turn-a-usb-drive-into-a-distraction-blocker",
    "website-blocker-you-cant-turn-off",
  ],
};
