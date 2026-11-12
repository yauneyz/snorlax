import Link from "next/link";
import { FREE_BLOCKED_SITE_LIMIT, PRO_TRIAL_DAYS } from "@talysman/product";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * The head term ("pornography blocker", "apps to block pornography", "best pornography blocker").
 * Unlisted: it's a way in for people looking for this, not part of the main pitch.
 *
 * The searcher has usually already tried one. Lists aren't the hard part — every option has a
 * good-enough list. The hard part is that the person who installs a blocker and the person who
 * wants it off at 1am are the same person, with the same password. So the page compares the
 * kinds of blocker by their off switch, not by their list, and says where ours stops too.
 *
 * Facts: the NSFW premade list is ~428k domains (packages/shared/src/premadeLists.ts, from
 * native/engine/resources/premade-lists/provenance.json) and is Pro-only (premadeListsEnabled in
 * @talysman/product limits). It's enforced by the extension's static DNR rulesets and by each
 * platform's service (native/*\/policy_match.rs). Desktop only: there is no phone blocker.
 */
export const pornographyBlocker: IntentPage = {
  slug: "pornography-blocker",
  group: "use-cases",
  unlisted: true,
  summary: "Pornography blockers compared by the thing that actually fails: the off switch.",
  lastReviewed: "2026-11-11",
  intent: "pornography blocker; apps to block pornography; best pornography blocker",
  eyebrow: "Pornography blocker",
  title: "A pornography blocker you can't switch off in a weak moment",
  metaTitle: `Pornography Blocker You Can't Switch Off on Impulse | ${config.app.name}`,
  metaDescription:
    "Block over 400,000 adult sites in every browser on Windows, Mac and Linux. Turning the blocker off needs a USB key you keep in another room.",
  ctaLabel: "Download free",
  lede: (
    <>
      Most pornography blockers have a good list. What lets them down is how easy they are to turn
      off, because the person who wants the block gone is the same person who knows the password.
    </>
  ),
  answer: (
    <>
      <p>
        The best pornography blocker is one you can&apos;t switch off on impulse, because most
        relapses start with someone turning their blocker off, not with a site it missed.{" "}
        {config.app.name} blocks a list of more than 400,000 adult domains in every browser on
        Windows, Mac and Linux. To turn the block off you have to plug in a USB key, and you keep
        that key somewhere else: in a drawer, in the car, or with someone you trust.
      </p>
      <p>
        It runs on computers only, not phones. Anyone with admin rights can eventually remove any
        blocker from their own computer, this one included. What it does is make the quick ways
        out stop working, so the urge has time to pass.
      </p>
    </>
  ),
  sections: [
    {
      kind: "demo",
      title: "What the moment looks like",
      lede: "It's late, you're alone, and the urge shows up. This is what happens next.",
      beats: [
        {
          label: "11:48 pm",
          body: "The NSFW list has been on for weeks, and so has the block. The USB key is in the glovebox of the car.",
        },
        {
          label: "11:52 pm",
          body: "You open a private window and type an address. You get the block page, the same one a normal window shows.",
        },
        {
          label: "11:53 pm",
          body: "You try a different browser. Blocking happens below the browser too, so that one is blocked as well.",
        },
        {
          label: "11:54 pm",
          body: "You open Talysman to turn the block off. It says: insert your key to turn off the blocker. There's no password box or confirm button.",
        },
        {
          label: "11:55 pm",
          body: "Getting the key means shoes, a coat, and a walk to the car in the dark. You don't go. By midnight the urge has faded.",
        },
      ],
      outcome: (
        <p>
          The key doesn&apos;t make you stronger. It turns a ten-second decision into a ten-minute
          one, and urges are bad at waiting ten minutes.
        </p>
      ),
      media: {
        label: "Demo: a private window, a second browser, and the key in the car",
        note: "A private window showing the block page, another browser blocked too, then turning focus off refused without the key, and the key in the car.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "table",
      title: "Kinds of pornography blocker, and how each one gets switched off",
      lede: "Any of these will block the sites you'd expect. The difference is what it takes to get around them at midnight.",
      columns: ["Kind of blocker", "How it usually gets switched off", "What it blocks"],
      rows: [
        [
          "Browser extension",
          "A private window, a second browser, or removing the extension. Each takes seconds.",
          "Sites in the browser it's installed in",
        ],
        [
          "Filtering DNS (family or adult filter)",
          "Change one network setting back, or turn on the browser's own secure DNS.",
          "Adult domains for the whole device, for free",
        ],
        [
          "Built-in parental controls",
          "The passcode. If you set it yourself, you know it.",
          "Adult sites, mainly in the system browser",
        ],
        [
          "Accountability software",
          "It rarely stops a visit. It works through a person who sees the report afterwards.",
          "Usually monitors and reports rather than blocks",
        ],
        [
          config.app.name,
          "Plug in a USB key that you keep somewhere else. There's no password or override button.",
          "400,000+ adult domains in every browser, plus any site or app you add",
        ],
      ],
      footnote: (
        <>
          These are general categories, not reviews of specific products. Some products combine
          two of them. Accountability software can work well if you have someone you&apos;re
          willing to tell.
        </>
      ),
    },
    {
      kind: "cards",
      title: "What you get",
      cards: [
        {
          title: "A big list you don't have to maintain",
          body: "The NSFW list combines open-source adult-domain lists, more than 400,000 domains in all. Add any site it misses, and allow-list anything it wrongly blocks.",
        },
        {
          title: "Every browser, including private windows",
          body: "The browser extension blocks the list, and a background service blocks it again at the network level. A private window or a second browser still hits the block.",
        },
        {
          title: "No password to remember in a bad moment",
          body: "The only way to turn the blocker off is a USB drive you paired. If someone else keeps it, you can't turn the block off without asking them.",
        },
        {
          title: "It stays on when you try the usual tricks",
          body: "Closing the app doesn't stop it, the service restarts itself, and a reboot brings the block back. On Windows and Linux the uninstaller refuses to run without the key.",
        },
        {
          title: "Nothing reported to anyone",
          body: "Talysman blocks. It doesn't record your browsing or send reports to a partner. If you want accountability, give your key to the person you'd tell.",
        },
        {
          title: "Scheduled lockdowns for the hard hours",
          body: "If late nights are when it goes wrong, schedule a locked window. Even the key can't end focus early during it.",
        },
      ],
    },
    {
      kind: "honesty",
      title: "What it won't do",
      body: (
        <>
          <p>
            <strong>It doesn&apos;t cover your phone.</strong> {config.app.name} runs on Windows,
            Mac and Linux. If the phone is where it happens, start with the{" "}
            <Link href="/block-adult-websites-on-phone">free phone settings guide</Link>. It covers
            iPhone and Android in about five minutes.
          </p>
          <p>
            <strong>It isn&apos;t unbeatable.</strong> Someone with admin rights, technical skill
            and enough time can get past any blocker on their own computer. A blocker that claims
            otherwise isn&apos;t being honest with you. What {config.app.name} takes away is the
            ten-second way out.
          </p>
          <p>
            <strong>It isn&apos;t treatment.</strong> A blocker gives you space in the moment, and
            that&apos;s all it does. If porn use is hurting your life, a counsellor, a support
            group or a friend you trust will help with things a blocker can&apos;t.
          </p>
        </>
      ),
    },
    {
      kind: "faq",
      items: [
        {
          q: "Is there a free pornography blocker?",
          a: (
            <p>
              Yes. On the free plan you can block {FREE_BLOCKED_SITE_LIMIT} sites you name, with
              the same key-protected off switch. The full 400,000-domain NSFW list is part of Pro,
              and you can{" "}
              <Link href="/pricing">try Pro free for {PRO_TRIAL_DAYS} days</Link>. For a free
              device-wide filter with no key, a family DNS filter is a good start. The{" "}
              <Link href="/adult-website-blocker">adult website blocker guide</Link> shows how to
              set one up.
            </p>
          ),
        },
        {
          q: "Is this an AI porn blocker?",
          a: (
            <p>
              No. Adult sites are blocked by a domain list, which is fast and predictable, and
              lists are never sent to the AI filter. {config.app.name} does have an optional AI
              filter for deciding whether a page is on-task, but it doesn&apos;t scan images.
            </p>
          ),
        },
        {
          q: "What if I need to turn it off for a real reason?",
          a: (
            <p>
              Go and get the key. That&apos;s the intended way out, and the walk is what gives you
              time to think. If the key is lost or broken, each computer gets five keyless
              emergency unlocks for its lifetime. You can pair spare keys, too.
            </p>
          ),
        },
        {
          q: "Can someone else hold the key?",
          a: (
            <p>
              Yes, and for many people that works best. Pair a drive, give it to a partner, friend
              or mentor, and the block can&apos;t come off without them. They don&apos;t see your
              browsing. They just hold the key.
            </p>
          ),
        },
        {
          q: "Does it block adult content on Reddit, X and other mixed sites?",
          a: (
            <p>
              The list blocks dedicated adult domains. Big mixed sites aren&apos;t on it, because
              most people need them for other things. If one of them is a problem for you, add it
              to your blocklist. Site rules can also hide feeds on sites like Reddit and X while
              keeping messages and search.
            </p>
          ),
        },
      ],
    },
  ],
  cta: {
    heading: "Put the off switch somewhere else",
    body: "Install it, turn on the NSFW list, pair a USB drive, and leave the drive in another room or with someone you trust.",
  },
  graphic: {
    kind: "ladder",
    title: "How each kind of blocker gets switched off",
    caption: "Five kinds of pornography blocker and the usual way each one gets switched off. Only Talysman needs a physical key.",
    fromTable: "Kinds of pornography blocker, and how each one gets switched off",
    rows: {
      "Browser extension": "cost",
      "Filtering DNS (family or adult filter)": "cost",
      "Built-in parental controls": "cost",
      "Accountability software": "cost",
      [config.app.name]: "open",
    },
  },
  related: [
    "adult-website-blocker",
    "block-adult-websites-on-phone",
    "website-blocker-you-cant-turn-off",
    "blocker-for-people-who-bypass-blockers",
  ],
};
