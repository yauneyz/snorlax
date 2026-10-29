import Link from "next/link";
import { FREE_BLOCKED_SITE_LIMIT, PRO_TRIAL_DAYS } from "@talysman/product";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * The category page. Someone searching "physical website blocker" has usually already worked out
 * on their own that software locks don't hold them — they're looking for a name for the thing
 * they want. Define the category first, sell second.
 */
export const physicalWebsiteBlocker: IntentPage = {
  slug: "physical-website-blocker",
  group: "guides",
  summary: "What a physical-key distraction blocker is, and how the lock types compare.",
  lastReviewed: "2026-10-07",
  intent: "physical website blocker / distraction blocker that requires a physical key",
  eyebrow: "Physical website blocker",
  title: `Physical website blocker for desktop: How ${config.app.name} protects your focus with a physical key`,
  metaTitle: `Physical Website Blocker for Desktop: How ${config.app.name} Protects Your Focus with a Physical Key`,
  metaDescription:
    "Move your distraction blocker's off-switch into the physical world using an ordinary USB drive.",
  lede: (
    <>
      Your website blocker is useless to you if you can just hit &ldquo;override&rdquo; whenever
      there is an urge to be distracted. {config.app.name} prevents this by only letting you turn
      the blocker off when there is a physical key inserted. The &ldquo;key&rdquo; is a USB drive
      that you pair with your computer. When you want to focus, you just turn on the blocker and put
      the key in another room.
    </>
  ),
  answer: (
    <>
      <p>
        Yes, there is a distraction blocker that requires a physical key: {config.app.name}. A
        physical website blocker is one where the thing that ends the block is an object, not a
        button, a password, or a timer you can wait out. If the object isn&apos;t in the room,
        neither is the option to turn off the blocker.
      </p>
      <p>
        {config.app.name} brings physical distraction blocking to the desktop. It blocks distracting
        websites and desktop applications on Windows, macOS and Linux, and turning focus off
        requires a paired USB drive to be physically plugged into the computer. The key can be any
        USB drive you already own — there is no hardware to buy and nothing to wait for in the mail.
      </p>
    </>
  ),
  sections: [
    {
      kind: "demo",
      title: "How it works",
      lede: "Check out this brief walk-through of how Talysman protects your focus",
      beats: [
        {
          label: "Pair",
          body: "Plug in a USB drive, pick it from the list, and it becomes a key for this computer.",
        },
        {
          label: "Block",
          body: "Add the sites that take your afternoons. Add the desktop apps too, or maybe just block the entire internet.",
        },
        {
          label: "Unplug",
          body: "Take the drive out of the machine and leave it somewhere inconvenient. This is the step that makes all the difference.",
        },
        {
          label: "Try to quit",
          body: "You try to turn of the blocker. Talysman checks for a paired key, doesn't find it, and declines. Focus stays on. You go back to work",
        },
      ],
      media: {
        label: "The refusal: “Insert your key to turn off the blocker”",
        note: "Screen recording of the End session dialog with the red key indicator, then a cut to the paired drive sitting on a kitchen counter.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "faq",
      items: [
        {
          q: "Does any USB drive work?",
          a: (
            <p>
              A standard USB drive, yes. {config.app.name} identifies it by the serial or volume ID
              it already reports; drives that report no usable identifier get one small marker file
              written at pairing so they can still be recognized.
            </p>
          ),
        },
        {
          q: "What happens in an emergency?",
          a: (
            <p>
              You go get the key, plug it in, and turn focus off. It&apos;s meant to be a walk, not
              a wall. If the key is truly out of reach, each computer has five keyless emergency
              unlocks for life — a real exit, deliberately too scarce to use on a whim. And a
              session only blocks what you put on the list — everything else on the computer keeps
              working the whole time.
            </p>
          ),
        },
        {
          q: "Is there a version where even the key doesn't work?",
          a: (
            <p>
              Yes, and it&apos;s opt-in. Mark a scheduled window <em>locked</em> and the key
              won&apos;t end focus early. The window releases on its own when it&apos;s over; the
              only way out before then is one of five emergency unlocks per computer, for life.
            </p>
          ),
        },
        {
          q: "Can I get around it?",
          a: (
            <>
              <p>
                A physical key raises the price of quitting; it doesn&apos;t make quitting
                impossible. Anyone with administrator rights on their own computer can eventually
                force the issue, and we&apos;d rather say that here than have you discover it and
                conclude we were selling something we couldn&apos;t deliver.
              </p>
              <p>
                It also can&apos;t help if the key stays plugged in. The mechanism is a walk down
                the hall, and the walk only exists if you put the drive somewhere that requires one.
              </p>
            </>
          ),
        },
        {
          q: "What does it cost?",
          a: (
            <p>
              Free covers {FREE_BLOCKED_SITE_LIMIT} blocked websites, unlimited manual sessions, and
              the key requirement — no card, no time limit. Pro adds app blocking, recurring
              schedules, unlimited sites and unlimited modes, free for {PRO_TRIAL_DAYS} days.{" "}
              <Link href="/pricing">See pricing</Link>.
            </p>
          ),
        },
      ],
    },
  ],
  cta: {
    heading: "Try the version of this that doesn't depend on willpower",
    body: "Pair a drive, block the sites that take your afternoons, and leave the key in the kitchen.",
  },
  related: [
    "website-blocker-you-cant-turn-off",
    "turn-a-usb-drive-into-a-distraction-blocker",
    "brick-for-computer",
  ],
};
