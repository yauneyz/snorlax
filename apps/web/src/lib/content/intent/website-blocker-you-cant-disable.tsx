import Link from "next/link";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * The searcher here is asking for something absolute, and the honest answer is "not absolute,
 * but expensive". Giving that answer in the first paragraph is the whole strategy: anyone who
 * has been burned by a blocker that oversold itself is reading for the catch, and finding it
 * volunteered is more persuasive than any claim we could make instead.
 */
export const websiteBlockerYouCantDisable: IntentPage = {
  slug: "website-blocker-you-cant-disable",
  intent: "website blocker you can't disable",
  eyebrow: "Website blocker you can't disable",
  title: "A website blocker you can't disable on impulse",
  metaTitle: `Website Blocker You Can't Disable — Every Exit, and What It Costs | ${config.app.name}`,
  metaDescription:
    "Closing the app, killing the service, rebooting and uninstalling all fail during a Talysman session. Ending focus early needs a paired USB key plugged in — here is every route out and exactly what happens.",
  lede: (
    <>
      Not &ldquo;impossible&rdquo; — we won&apos;t sell you that. Expensive: every route out of a
      session ends at a USB drive you deliberately left in another room.
    </>
  ),
  answer: (
    <>
      <p>
        {config.app.name} blocks websites and desktop apps from a privileged background service, so
        the usual exits don&apos;t work. Closing the app doesn&apos;t lift the block. Killing the
        service starts it again. Rebooting brings the session back intact. The uninstaller refuses
        to run during an active session. Ending focus early asks the service to physically verify a
        paired USB drive is plugged in — and if it isn&apos;t, the answer is no.
      </p>
      <p>
        Here is the honest limit, up front: anyone with administrator rights on their own computer
        can eventually force their way past any blocker, and that includes this one. What
        {" "}{config.app.name} guarantees is not impossibility. It&apos;s that the cheapest thing
        available to you in the moment you want to quit is going back to work.
      </p>
    </>
  ),
  sections: [
    {
      kind: "table",
      title: "Every way out, and what actually happens",
      lede: "The list you were going to test anyway, in the order most people try them.",
      columns: ["What you try", "What happens"],
      rows: [
        [
          "Click “End session”",
          "The service checks for a paired key. No drive plugged in, no unlock — and there's no override in the dialog.",
        ],
        [
          "Close the Talysman window",
          "Nothing changes. Enforcement never lived in the window; it lives in the background service.",
        ],
        [
          "Kill the background service",
          "It restarts itself. The session it was holding is unchanged when it comes back.",
        ],
        [
          "Restart or crash the computer",
          "The session survives. State is written to protected storage and the service starts with the machine.",
        ],
        [
          "Uninstall the app",
          "The uninstaller refuses to remove the service while focus is active unless a paired key is present.",
        ],
        [
          "Disable the browser extension",
          "Blocking is enforced below the browser as well, and a browser that can't enforce the list gets closed rather than left open.",
        ],
        [
          "Open a different browser",
          "Browsers without the extension are closed during a locked session, so “just use Edge” isn't the door it usually is.",
        ],
        [
          "Wait for the app to forget",
          "There's no grace period and no trusted window. The key is verified at the moment you ask, every time.",
        ],
        [
          "Go get the key",
          "It works. That's the intended exit, and it costs you a walk and a moment of clear thinking.",
        ],
      ],
      highlightLast: false,
    },
    {
      kind: "demo",
      title: "What it looks like when you try",
      lede: "The interaction the whole product exists for, beat by beat.",
      beats: [
        {
          label: "0:00",
          body: "A focus session is running. YouTube, Reddit and two desktop apps are on the list. The work is going fine.",
        },
        {
          label: "0:38",
          body: "The task turns ambiguous. You alt-tab, hit a block screen, and go to the Talysman window instead.",
        },
        {
          label: "0:41",
          body: "You click End session. A dialog: “Insert your key to end early.” The key indicator is red. There is no second button.",
        },
        {
          label: "0:44",
          body: "You remember the drive is on the kitchen counter, two rooms away, and that you put it there on purpose forty minutes ago while you were thinking clearly.",
        },
        {
          label: "0:52",
          body: "You go back to the editor. The urge that was going to cost you an hour cost you eleven seconds.",
        },
      ],
      outcome: (
        <p>
          Sometimes you do go get the drive. That&apos;s fine — a decision made on your feet, after
          a walk, is a different decision than a click made mid-sentence. The point was never to
          trap you. It was to make sure quitting is something you <em>choose</em>.
        </p>
      ),
      media: {
        label: "30-second demo: the refusal, and the walk you don't take",
        note: "Screen recording of the End session dialog with the red key indicator, cut to the drive on a counter in another room, cut back to the editor and typing resuming.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "cards",
      title: "Why the block holds where others don't",
      cards: [
        {
          title: "It runs below the browser",
          body: "The blocklist becomes browser-native rules and privileged enforcement on the machine, rather than a page script that a tab can be talked out of.",
        },
        {
          title: "The service outranks the app",
          body: "The window you see is a remote control. Everything that matters is held by a service that restarts itself and comes back after a reboot.",
        },
        {
          title: "The unlock is a physical check",
          body: "Not a password, not a confirmation, not a captcha. The service looks for a drive whose identifier matches one you paired.",
        },
        {
          title: "Locked windows go further",
          body: "Mark a scheduled window locked and even a paired key won't end focus early. It releases on its own when the window is over. Opt-in, and you should mean it.",
        },
      ],
    },
    {
      kind: "honesty",
      title: "What we're not claiming",
      body: (
        <>
          <p>
            This is not tamper-proof against you specifically, if you are determined, technical, and
            have an afternoon. Administrator rights on your own machine are administrator rights. A
            blocker that claims otherwise is either lying or is malware, and neither is what you
            want installed.
          </p>
          <p>
            What&apos;s defensible is narrower and more useful: the failure mode of every other
            blocker is a five-second decision made badly. {config.app.name} removes the five-second
            decision. If you still want out after standing up, walking to another room, and picking
            up a drive, you were not having a lapse — you were making a choice, and you should get
            to make it.
          </p>
        </>
      ),
    },
    {
      kind: "faq",
      items: [
        {
          q: "What if there's a real emergency?",
          a: (
            <p>
              You go get the key, plug it in, and turn focus off. Also worth knowing: a session only
              blocks what you put on the list, so everything else on your computer — email, phone
              calls, your work tools — keeps working the entire time.
            </p>
          ),
        },
        {
          q: "What if the drive breaks or gets lost?",
          a: (
            <p>
              Pair spares. Any paired drive unlocks, and you can pair as many as you like, so keep
              one somewhere safe today rather than finding out the hard way.
            </p>
          ),
        },
        {
          q: "Can I lock a session so even the key won't end it?",
          a: (
            <p>
              Yes — mark a scheduled window <em>locked</em>. Nothing ends focus early during it, and
              it releases automatically when the window closes. That&apos;s the strongest setting
              and it&apos;s deliberately opt-in.
            </p>
          ),
        },
        {
          q: "Does it need admin rights to install?",
          a: (
            <p>
              Yes. The enforcement service is privileged — that&apos;s exactly why closing a window
              or killing a process doesn&apos;t lift the block.{" "}
              <Link href="/download">See the downloads</Link> for your platform.
            </p>
          ),
        },
      ],
    },
  ],
  cta: {
    heading: "Test it against your own best workaround",
    body: "Start a free session, unplug the key, and try every trick you were going to try anyway.",
  },
  related: [
    "blocker-for-people-who-bypass-blockers",
    "physical-website-blocker",
    "how-to-stop-disabling-website-blockers",
  ],
};
