import type { Metadata } from "next";
import Link from "next/link";
import {
  formatPriceUsd,
  FREE_BLOCKED_SITE_LIMIT,
  PRO_LIST_PRICE_CENTS,
  PRO_PRICE_CENTS,
  PRO_TRIAL_DAYS,
} from "@talysman/product";
import { AppShot } from "@/components/marketing/AppShot";
import { HeroCopy } from "@/components/marketing/HeroCopy";
import { HeroDemo } from "@/components/marketing/HeroDemo";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  // Absolute so the root layout's "%s - Talysman" template doesn't repeat the brand name.
  title: {
    absolute: `${config.app.name} — Website & App Blocker You Can't Turn Off on Impulse`,
  },
  description: `${config.app.name} blocks distracting websites and desktop apps. Ending a focus session early requires a physical USB key you left in another room — paired from any USB drive you already own.`,
  alternates: { canonical: `${config.app.url}/` },
};

/** Shots are 4:3 captures of the real app — see scripts/capture-marketing.mjs. */
const steps = [
  {
    title: "Pair any USB drive",
    body: `Install ${config.app.name} and pair any USB drive you already own. That drive becomes your physical key. Pair as many as you like — any one of them unlocks.`,
    image: {
      src: "/media/app-pair-key.png",
      alt: "The Keys screen: two paired drives listed, a third selected in the removable-drive picker, and a green “Key mounted” indicator.",
    },
  },
  {
    title: "Choose what gets blocked",
    body: "Block distracting websites, and apps. Or go even further and allow only the tools you need. Start blocking immediately or create a schedule to protect the same hours every week.",
    image: {
      src: "/media/app-blocklist.png",
      alt: "The Blocklists screen: a “Deep work” profile blocking eight sites including youtube.com and reddit.com, plus Discord, Steam and Slack.",
    },
  },
  {
    title: "Unplug the key",
    body: "Put it in another room, a drawer, your car. Distractions remain blocked until you go get the key and plug it back in. No key, no unlock — even if you close the app or restart your computer.",
    image: {
      src: "/media/app-focused-key-away.png",
      alt: "The dashboard mid-session: the seal reads FOCUSED, the key readout reads “away”, and the header indicator reads NO KEY.",
    },
  },
];

/**
 * The diagnosis, drawn as two routes out of the same impulse. The point is the middle rung:
 * one path has a click there, the other has a walk.
 */
const paths = [
  {
    label: "Every other blocker",
    tone: "loss",
    beats: ["The urge hits", "Click “End session”", "The afternoon is gone"],
  },
  {
    label: config.app.name,
    tone: "ours",
    beats: ["The urge hits", "Get up and go get the key", "Decide whether you meant it"],
  },
];

/** Concrete situations, so the visitor can place themselves before reading capabilities. */
const uses = [
  "Finish the hard coding session instead of opening YouTube",
  "Write past the part that stopped being fun",
  "Study long enough to get through the difficult chapter",
];

/** Capabilities, stated as the outcome rather than the mechanism. */
const outcomes = [
  {
    title: "Keep YouTube and Reddit out of reach",
    body: "Website blocking runs below the browser, in a privileged background service. Closing the app window doesn't lift it.",
  },
  {
    title: "Close the apps that pull you away",
    body: "Desktop apps are blocked too, not just tabs. Discord and Steam don't get to be the loophole.",
  },
  {
    title: "Protect your best hours automatically",
    body: "Set recurring windows and distractions are blocked automatically — even if the app is closed and you never remember to start it.",
  },
  {
    title: "Turn your computer into a workstation",
    body: "Allow-only mode blocks everything except the tools the job actually needs. A work computer without buying a second computer.",
  },
];

const faqs = [
  {
    q: "Can I use any USB drive?",
    a: (
      <>
        <p>Yes — a standard drive you already own. Nothing to buy, nothing to ship.</p>
        <p>
          You can pair as many drives as you like. Any one of them unlocks, which is also the answer
          to losing one — pair a spare now and keep it somewhere safe.
        </p>
      </>
    ),
  },
  // {
  //   q: "What happens if I need to stop in an emergency?",
  //   a: (
  //     <>
  //       <p>
  //         You go get your key, plug it in, and turn focus off. That is the whole escape hatch. It is
  //         meant to be a walk, not a wall — inconvenient enough to beat an impulse, fast enough that
  //         a real emergency isn&apos;t a problem.
  //       </p>
  //       <p>
  //         Two things worth knowing. A focus session only blocks what you put on the list, so
  //         everything else on your computer keeps working the entire time. And if you deliberately
  //         mark a scheduled window <em>locked</em>, even the key won&apos;t disable focus during that
  //         window — it releases on its own when the window ends. Locked windows are opt-in.
  //       </p>
  //     </>
  //   ),
  // },
  {
    q: "Can't I just quit the app, restart, or uninstall during a session?",
    a: (
      <>
        <p>
          No. Closing the app changes nothing. The service restarts itself if it is killed, comes
          back after a reboot with the session intact, and the uninstaller refuses to remove it
          while focus is active unless a paired key is present.
        </p>
      </>
    ),
  },
  {
    q: `Does ${config.app.name} see or store my browsing history?`,
    a: (
      <>
        <p>
          No. The browser extension turns your blocklist into browser-native rules that the browser
          evaluates internally. The extension never receives the URLs you visit, your history, page
          content, search terms, cookies, or form data — and it makes no internet requests of its
          own. The block page doesn&apos;t even see which address was blocked.
        </p>
        <p>
          Your blocklist stays on your computer. Details are in the{" "}
          <Link href="/browser-extension-privacy">extension privacy policy</Link> and the{" "}
          <Link href="/privacy">main privacy policy</Link>.
        </p>
      </>
    ),
  },
  {
    q: "Can one key work across multiple computers?",
    a: (
      <p>
        Yes. Pair the same drive on each machine you install {config.app.name} on. Each computer
        keeps its own list of paired keys, so one drive can unlock your laptop and your desktop.
      </p>
    ),
  },
  {
    q: "What does it cost?",
    a: (
      <p>
        Free covers {FREE_BLOCKED_SITE_LIMIT} blocked websites and unlimited manual focus sessions,
        with no card and no time limit. Pro is {formatPriceUsd(PRO_PRICE_CENTS.monthly)}/month or{" "}
        {formatPriceUsd(PRO_PRICE_CENTS.yearly)}/year at the early adopter price (usually{" "}
        {formatPriceUsd(PRO_LIST_PRICE_CENTS.monthly)}/mo or{" "}
        {formatPriceUsd(PRO_LIST_PRICE_CENTS.yearly)}
        /year), and adds app blocking, recurring schedules, unlimited sites and unlimited profiles.
        New accounts get {PRO_TRIAL_DAYS} days of Pro free — see{" "}
        <Link href="/pricing">pricing</Link>.
      </p>
    ),
  },
  {
    q: "Which computers and browsers are supported?",
    a: (
      <p>
        Windows 10 and 11, macOS on Apple Silicon and Intel, and Debian/Ubuntu Linux, with
        extensions for Chrome and Firefox. <Link href="/download">See the downloads</Link>.
      </p>
    ),
  },
];

export default function LandingPage() {
  return (
    <>
      <section className="hero">
        <div className="hero__copy">
          <HeroCopy />
          <ul className="hero__trust" aria-label="Product highlights">
            <li>Free forever</li>
            <li>Use any USB drive</li>
            <li>Windows, macOS &amp; Linux</li>
          </ul>
        </div>

        <div className="hero__stage">
          <div className="hero__stage-glow" aria-hidden="true" />
          <HeroDemo />
        </div>
      </section>

      <section className="section" id="how">
        <p className="section__eyebrow">One calm decision. Three steps.</p>
        <h2 className="section__title">How It Works</h2>
        <p className="section__lede">Getting started with Talysman takes just a few clicks.</p>
        <ol className="steps">
          {steps.map((step, index) => (
            <li key={step.title} className="step">
              <AppShot
                src={step.image.src}
                alt={step.image.alt}
                width={2160}
                height={1620}
                className="step__media"
              />
              <span className="step__number" aria-hidden="true">
                {index + 1}
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* The named idea the rest of the page hangs on. Everything above is the visitor's
          experience; this is the diagnosis they haven't put into words yet. */}
      <section className="section diagnosis">
        <div className="diagnosis__lead">
          <div className="diagnosis__copy">
            <p className="section__eyebrow">The real problem</p>
            <h2 className="section__title">The off switch is the problem.</h2>
            <p>
              You installed the extensions. You set the timers. Then the work got difficult and
              YouTube was open before you had consciously decided to stop.
            </p>
            <p>
              Every normal blocker is controlled from the computer it is supposed to protect. The
              distracted version of you can undo the focused version&apos;s decision with the same
              mouse, in the same few clicks.
            </p>
            <p className="diagnosis__thesis">
              {config.app.name} moves that decision into the physical world. You can still stop. You
              just have to stand up and go get the key first.
            </p>
          </div>
          <AppShot
            src="/media/app-key-required.png"
            alt="The seal reading FOCUSED with the “Turn off focus” button greyed out and a red line beneath it: “insert key to turn off focus”."
            width={1410}
            height={940}
            className="diagnosis__media"
            sizes="(max-width: 900px) 100vw, 44vw"
          />
        </div>

        <ul className="paths">
          {paths.map((path) => (
            <li key={path.label} className={`path path--${path.tone}`}>
              <span className="path__label">{path.label}</span>
              <ol className="path__beats">
                {path.beats.map((beat) => (
                  <li key={beat}>{beat}</li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      </section>

      <section className="section">
        <p className="section__eyebrow">Built for the difficult middle</p>
        <h2 className="section__title">Starting is easy. Talysman protects what happens next.</h2>
        <p className="section__lede">
          Starting a focus session is easy. The hard part arrives twenty minutes later, when the
          work turns boring or frustrating and your hands start looking for an exit.
        </p>
        <ul className="uses">
          {uses.map((use) => (
            <li key={use} className="use">
              {use}
            </li>
          ))}
        </ul>
      </section>

      <section className="section">
        <p className="section__eyebrow">Strict where it matters</p>
        <h2 className="section__title">Block distractions without blocking your work.</h2>
        <p className="section__lede">
          Pick how strict the session needs to be — a handful of sites, only the tools the job
          needs, or nothing online at all.
        </p>
        <ul className="outcomes">
          {outcomes.map((outcome) => (
            <li key={outcome.title} className="outcome">
              <h3>{outcome.title}</h3>
              <p>{outcome.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Set expectations here rather than letting the pricing page be the first place a
          visitor learns app blocking and scheduling are paid. */}
      <section className="section split">
        <p className="section__eyebrow">A real free product</p>
        <h2 className="section__title">Prove the mechanism works before you pay.</h2>
        <p className="section__lede">
          Run unlimited manual sessions for free. Upgrade when you want Talysman to protect your
          entire week automatically.
        </p>
        <div className="split__grid">
          <div className="split__col">
            <span className="split__label">TRY THE MECHANISM</span>
            <h3>Free, forever</h3>
            <p>
              {FREE_BLOCKED_SITE_LIMIT} blocked websites, allow-only and block-all modes, manual
              focus sessions, and the key requirement to end one early.
            </p>
          </div>
          <div className="split__col split__col--pro">
            <span className="split__label">BUILD THE SYSTEM</span>
            <h3>Pro</h3>
            <p>
              Unlimited sites, desktop app blocking, recurring schedules that arm themselves, and
              unlimited profiles — the parts that turn one good session into a repeatable week.
            </p>
          </div>
        </div>
        <p className="split__cta">
          <Link href="/pricing" className="landing__cta landing__cta--secondary">
            Try Pro free for {PRO_TRIAL_DAYS} days
          </Link>
        </p>
      </section>

      <section className="section faq" id="faq">
        <p className="section__eyebrow">No hidden catches</p>
        <h2 className="section__title">Frequently asked questions</h2>
        <div className="faq__list">
          {faqs.map((faq) => (
            <details key={faq.q} className="faq__item">
              <summary>{faq.q}</summary>
              <div className="faq__answer">{faq.a}</div>
            </details>
          ))}
        </div>
      </section>

      <section className="cta-band">
        <p className="section__eyebrow">The next hard task is coming</p>
        <h2>Put the off switch in another room.</h2>
        <p>Use a USB drive you already own. Your first locked focus session is free.</p>
        <Link href="/download" className="landing__cta landing__cta--primary">
          Download Talysman free
        </Link>
        <p className="cta-band__note">
          Free forever, no card. Want schedules and app blocking?{" "}
          <Link href="/pricing">Try Pro free for {PRO_TRIAL_DAYS} days</Link>.
        </p>
      </section>
    </>
  );
}
