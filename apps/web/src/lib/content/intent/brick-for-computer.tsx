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
  showLastReviewed: true,
  intent:
    "brick for computer / is there anything like Brick for Windows or Mac / app like Brick but for desktop",
  eyebrow: "Brick for computer",
  title: "Brick for computer? Physical distraction blocking on desktop",
  metaTitle: "Brick for Computer? Physical Distraction Blocking on Desktop",
  metaDescription:
    "Looking for Brick-style physical friction on your work computer? Compare phone-focused Brick with Talysman's USB-key desktop approach.",
  lede: (
    <>
      Brick proved the point on phones: when unblocking means walking to a physical object, you
      mostly don&apos;t. {config.app.name} applies the same idea where your workday actually
      happens — and the key is a USB drive you already own.
    </>
  ),
  answer: (
    <>
      <p>
        Brick doesn&apos;t make a desktop or laptop version — it works with iPhones and Android
        phones only. The closest thing to Brick for a Windows PC, Mac or Linux computer is{" "}
        {config.app.name}, which uses a USB drive as the physical object instead of an NFC puck.
      </p>
      <p>
        Brick is a physical NFC tag. You tap your phone against it to block apps, and you have to
        tap it again to unblock them — so the off switch lives on a piece of plastic instead of in
        a menu. There is no way to tap a Brick with a desktop computer.
      </p>
      <p>
        {config.app.name} is the desktop version of that trade. It blocks distracting websites{" "}
        <em>and</em> desktop applications on Windows, macOS and Linux, and ending a focus session
        early requires a paired USB drive to be physically plugged into the machine. Leave the
        drive in another room and the session outlives your motivation. Nothing to buy and nothing
        to wait for in the mail — any drive in your desk drawer can be the key.
      </p>
    </>
  ),
  sections: [
    {
      kind: "demo",
      title: "What the tap becomes on a desktop",
      lede: "The same bargain, made with a USB port instead of an NFC tag. Here is the whole interaction.",
      beats: [
        {
          label: "Pair",
          body: "Plug in any USB drive. Talysman lists the removable drives it can see, you pick one, and it becomes a key for this computer. Pair a second drive as a spare if you want.",
        },
        {
          label: "Start",
          body: "Choose what to block — websites, desktop apps, or everything except a short allow list — and start a focus session.",
        },
        {
          label: "Unplug",
          body: "Take the drive out and put it somewhere that costs you a walk. Another room, a drawer downstairs, your car.",
        },
        {
          label: "Relapse",
          body: "Forty minutes in, the work gets hard and you click End session. Talysman asks the background service to check for a paired key. There isn't one plugged in, so focus stays on.",
        },
        {
          label: "Decide",
          body: "You either go get the drive — deliberately, on your feet, awake — or you go back to work. In practice most people go back to work.",
        },
      ],
      outcome: (
        <p>
          That is the entire mechanism. It is not clever and it is not trying to be: the point is
          that the cheapest available action at the moment of weakness is finishing the sentence
          you were writing.
        </p>
      ),
      media: {
        label: "30-second demo: clicking End session with the key in another room",
        note: "Screen recording. Session running → user clicks End session → “Insert your key to turn off the blocker” with the red key indicator → cut to the USB drive on a shelf in the next room → cut back to the editor.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "table",
      title: "Phone tag versus desktop key",
      lede: "Two takes on the same insight, aimed at different machines.",
      columns: ["", "Brick", `${config.app.name}`],
      rows: [
        ["Where it blocks", "Your phone", "Your Windows, macOS or Linux computer"],
        ["The physical object", "An NFC tag you buy", "A USB drive you already own"],
        ["How you unblock", "Tap the tag with your phone", "Plug the drive into the computer"],
        [
          "What gets blocked",
          "Apps and sites on the phone",
          "Websites and desktop applications, including the browsers you didn't install the extension in",
        ],
        ["If you left it behind", "Blocked until you go get it", "Blocked until you go get it"],
        [
          "If the object is lost",
          "Five emergency unBricks, refreshed through support",
          "Five keyless emergency unlocks per computer, for life — and spare drives",
        ],
        ["Cost to start", "Buy the tag, wait for delivery", `Free for ${FREE_BLOCKED_SITE_LIMIT} blocked sites, no card`],
      ],
      highlightLast: true,
      footnote: (
        <>
          {config.app.name} isn&apos;t affiliated with Brick, and this compares the two mechanisms
          rather than two feature lists. Brick&apos;s platforms (iOS 17+ and Android 12+) are from{" "}
          <a href="https://getbrick.com/pages/apple" rel="nofollow noopener">
            its compatibility page
          </a>
          ; check their site for what Brick does today. The two also
          aren&apos;t mutually exclusive. If your phone is the problem <em>and</em> your computer
          is the problem, they solve different halves of it.
        </>
      ),
    },
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
          body: "The uninstaller refuses to remove the service while a focus session is running unless a paired key is present.",
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
            past any blocker, this one included. We aren&apos;t going to pretend otherwise. The
            goal is to make cheating cost more effort than doing the work — a walk down the hall
            beats an impulse, and that turns out to be enough on the ordinary Tuesday when the task
            is just boring.
          </p>
          <p>
            If you want the version that even the key can&apos;t end, mark a scheduled window{" "}
            <em>locked</em>. It releases on its own when the window is over, and the only other way out
            is one of five emergency unlocks you get per computer, for life. That&apos;s opt-in, and you should mean it.
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
              hardware serial or volume ID it already reports, so normally nothing is written to
              the drive at all — and the drive keeps working as a normal drive.
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
              Intel, and Debian/Ubuntu Linux, with extensions for Chrome and Firefox. If the phone
              is your main problem, a phone-first tool is the honest answer for that half.{" "}
              <Link href="/download">See the downloads</Link>.
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
    caption: "Brick's NFC tag and Talysman's USB key side by side: what each blocks and how each unblocks.",
    fromTable: "Phone tag versus desktop key",
    rows: [
      "Where it blocks",
      "The physical object",
      "How you unblock",
      "If the object is lost",
      "Cost to start",
    ],
  },
  related: [
    "physical-website-blocker",
    "turn-a-usb-drive-into-a-distraction-blocker",
    "website-blocker-you-cant-turn-off",
  ],
};
