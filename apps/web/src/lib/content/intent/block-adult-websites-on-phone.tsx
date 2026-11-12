import Link from "next/link";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * "how to block adult websites on my phone / android / android phone", "block adult websites
 * android", "how to block 18+ websites on android", "…on google chrome in android". Unlisted.
 *
 * Talysman doesn't run on phones, and this page says so in the answer. It's a straight, free
 * how-to using what iOS and Android already ship. It earns its place by being the most useful
 * answer to the query. The product only comes in for the other half of the problem: the computer.
 *
 * Facts (checked 2026-11-11):
 *  - iPhone: Settings → Screen Time → Content & Privacy Restrictions → … → Web Content → Limit
 *    Adult Websites; "Never Allow" adds sites (support.apple.com/guide/iphone/iph3ff83f3b1/ios).
 *  - Android 9+: Settings → Network & internet → (Advanced →) Private DNS → Private DNS provider
 *    hostname. Hostnames: family.cloudflare-dns.com (developers.cloudflare.com/1.1.1.1/setup/android),
 *    adult-filter-dns.cleanbrowsing.org (cleanbrowsing.org/support/mobile/android-private-dns).
 *  - SafeSearch only filters Google's results (support.google.com/websearch/answer/510).
 */
export const blockAdultWebsitesOnPhone: IntentPage = {
  slug: "block-adult-websites-on-phone",
  group: "guides",
  unlisted: true,
  showLastReviewed: true,
  summary: "Free steps to block adult sites on Android and iPhone, using settings the phone already has.",
  lastReviewed: "2026-11-11",
  intent: "how to block adult websites on my phone; block adult websites android; how to block 18+ websites on android",
  eyebrow: "Block adult websites on your phone",
  title: "How to block adult websites on your phone (Android and iPhone)",
  metaTitle: "How to Block Adult Websites on Android and iPhone, Free",
  metaDescription:
    "Block adult sites on Android with Private DNS and on iPhone with Screen Time. Free, no app needed, and it covers Chrome and every other browser.",
  ctaLabel: "Get the computer blocker",
  demoInPlace: true,
  lede: (
    <>
      Both iPhone and Android can block adult sites without an app. This guide walks through each
      setting, then shows how to make it hard to switch off again.
    </>
  ),
  answer: (
    <>
      <p>
        To block adult websites on an <strong>Android</strong> phone, go to Settings → Network
        &amp; internet → Private DNS, choose <em>Private DNS provider hostname</em>, and enter{" "}
        <code>family.cloudflare-dns.com</code>. That blocks adult sites in Chrome and every other
        app. On an <strong>iPhone</strong>, go to Settings → Screen Time → Content &amp; Privacy
        Restrictions, turn it on, and set Web Content to <em>Limit Adult Websites</em>.
      </p>
      <p>
        Both are free and take about two minutes. But you can switch either one off just as fast,
        unless someone else sets the passcode. {config.app.name} is a computer blocker, not a phone
        app. If your laptop is the weak spot, the last section covers it.
      </p>
    </>
  ),
  sections: [
    {
      kind: "steps",
      id: "android",
      title: "Android: block adult sites in every app with Private DNS",
      lede: "Works on Android 9 and later. Menu names vary a little by phone maker.",
      steps: [
        {
          title: "Open Private DNS",
          body: (
            <>
              Settings → <strong>Network &amp; internet</strong> → Private DNS. On some phones
              it&apos;s under Advanced or under Connections → More connection settings. If you
              can&apos;t find it, search Settings for &ldquo;Private DNS&rdquo;.
            </>
          ),
        },
        {
          title: "Enter a family filter",
          body: (
            <>
              Choose <em>Private DNS provider hostname</em> and enter{" "}
              <code>family.cloudflare-dns.com</code> (Cloudflare, blocks adult content and
              malware) or <code>adult-filter-dns.cleanbrowsing.org</code> (CleanBrowsing&apos;s
              adult filter). Tap Save.
            </>
          ),
        },
        {
          title: "Turn on SafeSearch",
          body: (
            <>
              In the Google app or at google.com, set SafeSearch to <strong>Filter</strong>. It
              hides explicit results and images in Google searches. The DNS filter handles the
              sites themselves.
            </>
          ),
        },
        {
          title: "Check it works",
          body: (
            <>
              Open Chrome and visit a site you expect to be blocked. You should see a
              connection error instead of the page. If it still loads, check the hostname for
              typos and turn Wi-Fi off and on.
            </>
          ),
        },
      ],
    },
    {
      kind: "steps",
      id: "iphone",
      title: "iPhone: Screen Time's adult website filter",
      lede: "Built into iOS, and it covers Safari and most other browsers on the phone.",
      steps: [
        {
          title: "Turn on Content & Privacy Restrictions",
          body: (
            <>
              Settings → <strong>Screen Time</strong> → Content &amp; Privacy Restrictions, and
              switch it on.
            </>
          ),
        },
        {
          title: "Limit adult websites",
          body: (
            <>
              Find <strong>Web Content</strong> (under App Store, Media, Web &amp; Games, or Content
              Restrictions on older iOS) and choose <em>Limit Adult Websites</em>. Add any site it
              misses under <em>Never Allow</em>.
            </>
          ),
        },
        {
          title: "Set a Screen Time passcode you don't know",
          body: (
            <>
              This is the step that makes it stick. Have a partner or friend type the Screen Time
              passcode so that you never see it. Without it, the setting is two taps from off.
            </>
          ),
        },
      ],
    },
    {
      kind: "table",
      title: "How easy each setting is to switch off",
      lede: "These settings aren't hard to set up. What matters is what happens when you want them gone.",
      columns: ["Setting", "Switched off by", "Makes it harder"],
      rows: [
        [
          "Android Private DNS",
          "Settings → Private DNS → Off. Takes about ten seconds.",
          "A parental-control account, or a filtering app with its own lock",
        ],
        [
          "iPhone Screen Time limit",
          "The Screen Time passcode",
          "Someone else choosing the passcode",
        ],
        [
          "Google SafeSearch",
          "One toggle, and it never covered sites you type in directly",
          "A supervised Google account",
        ],
        [
          "A filtering app",
          "Uninstalling it, unless it has device-admin protection",
          "A PIN held by someone else",
        ],
      ],
      footnote: (
        <>
          The pattern holds for every option: a setting you control alone is easy to undo, and one
          someone else controls isn&apos;t.
        </>
      ),
    },
    {
      kind: "demo",
      id: "demo",
      title: "If it's the computer, not the phone",
      lede: "The phone is done. For a lot of people, the laptop late at night is the harder part. This is the computer side, with Talysman.",
      beats: [
        {
          label: "Phone",
          body: "Private DNS is on and someone else holds the Screen Time passcode. The phone is covered.",
        },
        {
          label: "Laptop, late",
          body: "The urge moves to the laptop. You type an adult site's address and get the block page, in every browser.",
        },
        {
          label: "Turn off",
          body: "You open Talysman to turn it off. It says: insert your key to turn off the blocker.",
        },
        {
          label: "The key",
          body: "The USB key is with the same person who set your phone passcode. That's not a call you'll make at midnight.",
        },
      ],
      media: {
        label: "Demo: the laptop blocked, the key with someone else",
        note: "An adult site blocked on the computer, turning focus off refused without the USB key, and the key kept by someone else.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "honesty",
      title: "What this guide can't promise",
      body: (
        <>
          <p>
            No filter catches every adult site, and there&apos;s always a workaround on a device you
            own: a VPN, a different network, a factory reset. These settings won&apos;t make
            relapse impossible. They make it slower, and slower is often enough.
          </p>
          <p>
            {config.app.name} isn&apos;t a phone app, and this page isn&apos;t a pitch for one.
            If the computer matters too, the{" "}
            <Link href="/pornography-blocker">pornography blocker page</Link> explains what it
            does there.
          </p>
        </>
      ),
    },
    {
      kind: "faq",
      items: [
        {
          q: "How do I block adult websites in Chrome on Android?",
          a: (
            <p>
              Use Private DNS (the Android steps above). Chrome on Android has no built-in adult
              site filter of its own, but Private DNS applies to Chrome and every other app on the
              phone.
            </p>
          ),
        },
        {
          q: "How do I block 18+ websites on Android for free?",
          a: (
            <p>
              Private DNS with <code>family.cloudflare-dns.com</code> or{" "}
              <code>adult-filter-dns.cleanbrowsing.org</code> is free, needs no app, and covers
              the whole phone.
            </p>
          ),
        },
        {
          q: "Will Private DNS slow down my phone?",
          a: (
            <p>
              Not noticeably. It only changes who answers your phone&apos;s address lookups, and
              these family filters are run by large DNS providers.
            </p>
          ),
        },
        {
          q: "Does Talysman have a phone app?",
          a: (
            <p>
              No. {config.app.name} runs on Windows, Mac and Linux. On your phone, use the free
              settings above.
            </p>
          ),
        },
      ],
    },
  ],
  cta: {
    heading: "Now cover the computer",
    body: "Talysman blocks over 400,000 adult sites in every browser on Windows, Mac and Linux. Turning it off needs a USB key, so give the key to the person who holds your phone passcode.",
  },
  graphic: {
    kind: "ladder",
    title: "How easy each phone setting is to switch off",
    caption: "Android Private DNS, iPhone Screen Time, Google SafeSearch and filtering apps: what it takes to switch each one off.",
    fromTable: "How easy each setting is to switch off",
    rows: {
      "Android Private DNS": "cost",
      "iPhone Screen Time limit": "cost",
      "Google SafeSearch": "cost",
      "A filtering app": "cost",
    },
  },
  related: [
    "pornography-blocker",
    "adult-website-blocker",
    "blocker-for-people-who-bypass-blockers",
  ],
};
