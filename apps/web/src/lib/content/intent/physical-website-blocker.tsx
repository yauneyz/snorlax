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
  intent: "physical website blocker",
  eyebrow: "Physical website blocker",
  title: "A website blocker with a physical key",
  metaTitle: `Physical Website Blocker for Desktop — Unlock With a USB Key | ${config.app.name}`,
  metaDescription:
    "A physical website blocker puts the off switch on an object instead of in a menu. Talysman blocks sites and desktop apps on Windows, macOS and Linux, and only unlocks when your paired USB key is plugged in.",
  lede: (
    <>
      Every software lock ends in a decision you make at the keyboard, in the worst possible
      second. A physical lock ends in a walk.
    </>
  ),
  answer: (
    <>
      <p>
        A physical website blocker is one where the thing that ends the block is an object, not a
        button, a password, or a timer you can wait out. If the object isn&apos;t in the room,
        neither is the option.
      </p>
      <p>
        {config.app.name} is that, built for desktops. It blocks distracting websites and desktop
        applications on Windows, macOS and Linux, and turning focus off early requires a paired USB
        drive to be physically plugged into the computer. The key is any drive you already own —
        there is no hardware to buy and nothing to wait for in the mail.
      </p>
    </>
  ),
  sections: [
    {
      kind: "table",
      title: "Why the other kinds of lock come off",
      lede: "Every blocker has a lock. What separates them is what it costs you to undo it at the exact moment you want to.",
      columns: ["The lock", "What it costs to undo", "Where it fails"],
      rows: [
        [
          "A button in the app",
          "One click",
          "The impulse and the escape are the same gesture. You're past it before you notice you decided.",
        ],
        [
          "A password you set",
          "Typing a password you know",
          "You chose it. Future you has it. It only stops other people.",
        ],
        [
          "A password a friend holds",
          "One text message",
          "Works right up until it's 11pm, or they answer, or you stop asking and just uninstall.",
        ],
        [
          "A random string to retype",
          "30 to 60 seconds of typing",
          "It's a toll, not a wall. Once you've decided to quit, you'll pay it — and the second time is faster.",
        ],
        [
          "A timer you wait out",
          "Waiting",
          "Waiting is something you can do in another tab. The block ends on its own schedule, not on the work being done.",
        ],
        [
          "A physical key in another room",
          "Standing up and walking there",
          "It fails if you keep the key on the desk. That part is on you.",
        ],
      ],
      footnote: (
        <>
          Every one of these locks works when you&apos;re calm. The question a blocker is actually
          judged on is what happens forty minutes in, when the task turns ambiguous and you go
          looking for an exit without quite admitting that&apos;s what you&apos;re doing.
        </>
      ),
    },
    {
      kind: "demo",
      title: "The moment a physical lock is different",
      lede: "Everything up to the fourth beat is the same in every blocker ever made. The fourth beat is the product.",
      beats: [
        {
          label: "Pair",
          body: "Plug in a USB drive, pick it from the list of removable drives, and it becomes a key for this computer.",
        },
        {
          label: "Block",
          body: "Add the sites that take your afternoons. Add the desktop apps too, or flip to allow-only and permit just the tools the job needs.",
        },
        {
          label: "Unplug",
          body: "Take the drive out of the machine and leave it somewhere inconvenient. This is the step that does the work.",
        },
        {
          label: "Try to quit",
          body: "You click End session. The background service checks for a paired key, finds no drive, and declines. Focus stays on. There is no override in the dialog, because an override is just a slower button.",
        },
        {
          label: "Come back",
          body: "When the session ends — or when you fetch the key on purpose — everything unblocks at once. Nothing is left behind on your machine.",
        },
      ],
      media: {
        label: "The refusal: “Insert your key to end early”",
        note: "Screen recording of the End session dialog with the red key indicator, then a cut to the paired drive sitting on a kitchen counter.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "cards",
      title: "What “physical” has to mean to be worth anything",
      lede: "A key on the desk is a decoration. These are the parts that make the key the only door.",
      cards: [
        {
          title: "The block doesn't live in the window",
          body: "Enforcement runs in a privileged background service. Closing the app, killing the process, or rebooting doesn't lift it — the service comes back with the session intact.",
        },
        {
          title: "The uninstaller is gated too",
          body: "It refuses to remove the service during an active session unless a paired key is present. Otherwise “uninstall” is just the unlock button with extra steps.",
        },
        {
          title: "Other browsers aren't a side door",
          body: "Chrome and Firefox get the extension. During a locked session, browsers without it get closed instead of left open as the obvious workaround.",
        },
        {
          title: "Apps are blocked, not just tabs",
          body: "The desktop apps that pull you away are covered as well, so quitting the browser doesn't just relocate the problem.",
        },
        {
          title: "The key is verified, not remembered",
          body: "The service checks for the drive at the moment you ask to unlock. There's no session token, no grace period, no “trusted for 15 minutes”.",
        },
        {
          title: "You can have more than one",
          body: "Pair as many drives as you like — any one of them unlocks. A lost key is an inconvenience, not a lockout.",
        },
      ],
    },
    {
      kind: "prose",
      title: "Why the key is a drive you already own",
      body: (
        <>
          <p>
            A dedicated piece of hardware sounds more serious, and it costs you a purchase, a
            shipping wait, and a single point of failure the day you lose it. A USB drive skips all
            three. The one in your desk drawer works, the one from a conference works, and you can
            pair three of them this afternoon.
          </p>
          <p>
            Your files, your blocklist, and your account never touch the drive.{" "}
            {config.app.name} normally just reads the hardware serial or volume ID the drive
            already reports. The one exception is a drive with no usable identifier, where pairing
            writes a single small marker file so presence can still be detected. The drive stays a
            normal drive the whole time — you can keep using it for files.
          </p>
        </>
      ),
    },
    {
      kind: "honesty",
      title: "The limits, stated plainly",
      body: (
        <>
          <p>
            A physical key raises the price of quitting; it doesn&apos;t make quitting impossible.
            Anyone with administrator rights on their own computer can eventually force the issue,
            and we&apos;d rather say that here than have you discover it and conclude we were
            selling something we couldn&apos;t deliver.
          </p>
          <p>
            It also can&apos;t help if the key stays plugged in. The mechanism is a walk down the
            hall, and the walk only exists if you put the drive somewhere that requires one.
          </p>
        </>
      ),
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
              a wall. And a session only blocks what you put on the list — everything else on the
              computer keeps working the whole time.
            </p>
          ),
        },
        {
          q: "Is there a version where even the key doesn't work?",
          a: (
            <p>
              Yes, and it&apos;s opt-in. Mark a scheduled window <em>locked</em> and nothing ends
              focus early, key included. The window releases on its own when it&apos;s over.
            </p>
          ),
        },
        {
          q: "What does it cost?",
          a: (
            <p>
              Free covers {FREE_BLOCKED_SITE_LIMIT} blocked websites, unlimited manual sessions,
              and the key requirement — no card, no time limit. Pro adds app blocking, recurring
              schedules, unlimited sites and unlimited profiles, free for {PRO_TRIAL_DAYS} days.{" "}
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
    "website-blocker-you-cant-disable",
    "turn-a-usb-drive-into-a-distraction-blocker",
    "brick-for-desktop",
  ],
};
