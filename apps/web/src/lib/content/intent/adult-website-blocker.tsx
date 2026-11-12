import Link from "next/link";
import { FREE_BLOCKED_SITE_LIMIT, PRO_TRIAL_DAYS } from "@talysman/product";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * "adult site blocker", "adult website blocker", "block adult websites on chrome", "…in firefox",
 * "…on mac". Unlisted, like the other adult-content pages.
 *
 * Distinct from /pornography-blocker (which compares kinds of blocker by their off switch): this
 * one is a desktop-browser how-to. It gives the free settings for Chrome, Firefox, Windows and
 * Mac first, honestly, then the table of where a browser-level block stops working.
 *
 * Facts: Cloudflare's family resolver is 1.1.1.3 / 1.0.0.3 and
 * https://family.cloudflare-dns.com/dns-query (developers.cloudflare.com/1.1.1.1/setup). SafeSearch
 * only filters Google's results (support.google.com/websearch/answer/510). Talysman's encrypted-DNS
 * coverage differs by platform (snorlax-architecture.md, "Change DNS server"), so that row says so.
 */
export const adultWebsiteBlocker: IntentPage = {
  slug: "adult-website-blocker",
  group: "guides",
  unlisted: true,
  showLastReviewed: true,
  summary: "Free ways to block adult sites in Chrome, Firefox, Windows and Mac, and where each stops working.",
  lastReviewed: "2026-11-11",
  intent: "adult website blocker; adult site blocker chrome; how to block adult websites on google chrome",
  eyebrow: "Adult website blocker",
  title: "How to block adult websites in Chrome, Firefox and every other browser",
  metaTitle: "Adult Website Blocker for Chrome, Firefox, Windows and Mac",
  metaDescription:
    "Free settings that block adult sites in Chrome and Firefox, why an incognito window gets past most of them, and a blocker that covers every browser.",
  ctaLabel: "Download free",
  lede: (
    <>
      You can block adult sites in Chrome in about two minutes for free. The catch is that a block
      living in one browser is easy to step around in an incognito window.
    </>
  ),
  answer: (
    <>
      <p>
        To block adult websites in Chrome, point the browser&apos;s secure DNS at a family filter
        such as Cloudflare&apos;s (<code>https://family.cloudflare-dns.com/dns-query</code>) and
        turn Google SafeSearch to Filter. Do the same in Firefox, or set the filter for the whole
        computer in Windows or macOS network settings. All of this is free, and it&apos;s enough
        to stop accidents.
      </p>
      <p>
        These settings stop accidents, but they won&apos;t stop you on purpose: you can undo each
        one in a few clicks. If you need a block that survives your own bad moments,{" "}
        {config.app.name} blocks more than 400,000 adult domains in every browser, private windows
        included. Turning it off needs a USB key that you keep in another room.
      </p>
    </>
  ),
  sections: [
    {
      kind: "demo",
      title: "One block, three browsers",
      lede: "The tricks that get past a block in a single browser, tried against Talysman one by one.",
      beats: [
        {
          label: "Chrome",
          body: "You type an adult site's address into Chrome and get Talysman's block page.",
        },
        {
          label: "Incognito",
          body: "Next you try a private window, where most browser extensions are switched off. The site is still blocked.",
        },
        {
          label: "Firefox",
          body: "So you open Firefox, a browser you never set anything up in. Blocked again: the service blocks below the browser, so every browser is covered.",
        },
        {
          label: "Turn off",
          body: "Last, you open Talysman to turn the blocker off. It asks for the key, and there's no other button.",
        },
        {
          label: "The key",
          body: "The key is in a drawer two rooms away, and you don't get up to fetch it.",
        },
      ],
      media: {
        label: "Demo: Chrome, incognito and Firefox all blocked, then the key refusal",
        note: "Block page in Chrome, then a private window, then Firefox, then turning focus off refused without the USB key.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "steps",
      title: "The free way: four settings, about ten minutes",
      lede: "Do these whether or not you install anything. They catch the accidental clicks and cost nothing.",
      steps: [
        {
          title: "Turn SafeSearch to Filter",
          body: (
            <>
              Go to Google&apos;s SafeSearch settings and choose <strong>Filter</strong>. It hides
              explicit results from Google searches. It doesn&apos;t block a site you type in
              directly, so treat it as a first layer.
            </>
          ),
        },
        {
          title: "Chrome: use a family DNS filter",
          body: (
            <>
              Open Settings → Privacy and security → Security → <strong>Use secure DNS</strong>.
              Choose a custom provider and enter{" "}
              <code>https://family.cloudflare-dns.com/dns-query</code>. Chrome then refuses to look
              up adult domains.
            </>
          ),
        },
        {
          title: "Firefox: the same filter",
          body: (
            <>
              Open Settings → Privacy &amp; Security → <strong>DNS over HTTPS</strong>. Choose Max
              Protection with a custom provider and enter the same address. Firefox keeps its own
              DNS settings, so setting up Chrome doesn&apos;t cover it.
            </>
          ),
        },
        {
          title: "Windows or Mac: the whole computer",
          body: (
            <>
              On Windows, set your network adapter&apos;s DNS servers to <code>1.1.1.3</code> and{" "}
              <code>1.0.0.3</code> (Settings → Network &amp; internet → your connection → DNS
              server assignment). On a Mac, also turn on System Settings → Screen Time → Content
              &amp; Privacy and set web content to <strong>Limit Adult Websites</strong>. It works
              best in Safari.
            </>
          ),
        },
      ],
    },
    {
      kind: "table",
      title: "Where a single-browser block stops working",
      lede: "The ways around an adult site blocker, in the order people usually try them.",
      columns: ["What you try", "Chrome extension or DNS setting", config.app.name],
      rows: [
        [
          "Open an incognito window",
          "Most extensions are off in incognito unless you allow them",
          "Still blocked. The service blocks below the browser",
        ],
        [
          "Use another browser",
          "Not covered unless you set that browser up too",
          "Still blocked, in every browser on the computer",
        ],
        [
          "Remove the extension",
          "Takes one click on the extensions page",
          "The network block stays. With Strict Mode on, browsers without the extension are closed",
        ],
        [
          "Change the DNS setting back",
          "Takes a few clicks in settings",
          "Doesn't need DNS settings. On Windows, known encrypted-DNS routes are blocked too",
        ],
        [
          "Turn the blocker off",
          "A toggle or a password you set yourself",
          "Needs a paired USB key plugged in",
        ],
        [
          "Uninstall it",
          "Takes a few seconds",
          "On Windows and Linux, refused without the key. Not key-gated on Mac",
        ],
      ],
      highlightLast: true,
      footnote: (
        <>
          Some Chrome extensions and DNS services add a password or a delay before you can turn
          them off. That helps, but if you set the password yourself, you know it.
        </>
      ),
    },
    {
      kind: "cards",
      title: "Free or paid, which do you need?",
      cards: [
        {
          title: "Avoiding accidents? Use the free settings",
          body: "If you mostly want explicit results and pop-ups gone, SafeSearch and a family DNS filter are enough. Nothing to install.",
        },
        {
          title: "Trying to quit? Make the block hard to undo",
          body: "If you've switched blockers off before, the list isn't the problem. The quick off switch is. That's the part Talysman replaces with a key.",
        },
        {
          title: `Free plan: ${FREE_BLOCKED_SITE_LIMIT} sites, same key`,
          body: `The free plan blocks ${FREE_BLOCKED_SITE_LIMIT} sites you choose, with the key-protected off switch. The 400,000-domain NSFW list is part of Pro, with a ${PRO_TRIAL_DAYS}-day free trial.`,
        },
      ],
    },
    {
      kind: "honesty",
      title: "The limits",
      body: (
        <>
          <p>
            No adult site list is complete, because new domains appear every day. The NSFW list
            combines several open-source lists and covers the well-known sites, and you can add
            any site it misses with one entry.
          </p>
          <p>
            It works on computers only. For a phone, use the free settings in the{" "}
            <Link href="/block-adult-websites-on-phone">phone guide</Link>. And anyone with admin
            rights can eventually remove software from their own computer. {config.app.name}
            doesn&apos;t make that impossible. It makes it slow.
          </p>
        </>
      ),
    },
    {
      kind: "faq",
      items: [
        {
          q: "Is there a Chrome extension that blocks adult sites?",
          a: (
            <p>
              Yes, several, and {config.app.name} ships one too. But an extension alone only
              covers the browser it&apos;s installed in, and usually not incognito. {config.app.name}
              {" "}pairs its extension with a service that blocks the same list below the browser.
            </p>
          ),
        },
        {
          q: "How do I block adult websites in Chrome on Android?",
          a: (
            <p>
              Use Android&apos;s Private DNS setting, which covers Chrome and every other app. The{" "}
              <Link href="/block-adult-websites-on-phone">phone guide</Link> has the exact steps.
            </p>
          ),
        },
        {
          q: "Does it slow down browsing?",
          a: (
            <p>
              No. The list is checked locally against the address being visited, so pages
              that aren&apos;t blocked load as normal.
            </p>
          ),
        },
        {
          q: "Can I unblock a site the list gets wrong?",
          a: (
            <p>
              Yes. Add it to your allow list. An allowed domain is excluded from the premade lists.
            </p>
          ),
        },
      ],
    },
  ],
  cta: {
    heading: "Block it in every browser, not just Chrome",
    body: "Turn on the NSFW list, pair a USB drive, and keep the drive in another room.",
  },
  graphic: {
    kind: "compare",
    title: "Where a single-browser block stops working",
    caption: "Incognito, another browser, removing the extension and turning it off: a Chrome extension or DNS setting against Talysman.",
    fromTable: "Where a single-browser block stops working",
    rows: [
      "Open an incognito window",
      "Use another browser",
      "Remove the extension",
      "Turn the blocker off",
    ],
  },
  related: [
    "pornography-blocker",
    "block-adult-websites-on-phone",
    "website-blocker-windows",
    "website-blocker-mac",
  ],
};
