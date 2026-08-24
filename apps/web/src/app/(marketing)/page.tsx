import type { Metadata } from "next";
import Link from "next/link";
import {
  formatPriceUsd,
  FREE_BLOCKED_SITE_LIMIT,
  PRO_ANNUAL_MONTHLY_EQUIVALENT_CENTS,
  PRO_PRICE_CENTS,
  PRO_TRIAL_DAYS,
} from "@talysman/product";
import { AppShot } from "@/components/marketing/AppShot";
import { HeroDemo } from "@/components/marketing/HeroDemo";
import { MediaPlaceholder } from "@/components/marketing/MediaPlaceholder";
import { PlatformIcon, type Platform } from "@/components/marketing/PlatformIcon";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  // Absolute so the root layout's "%s - Talysman" template doesn't repeat the brand name.
  title: {
    absolute: `${config.app.name} — Website & App Blocker You Can't Turn Off on Impulse`,
  },
  description: `${config.app.name} blocks distracting websites and desktop apps. Ending a focus session early requires a physical USB key you left in another room — paired from any USB drive you already own.`,
  alternates: { canonical: `${config.app.url}/` },
};

/** Above-the-fold compatibility strip. Answers "does it run on my machine" before the scroll. */
const platforms: { platform: Platform; label: string }[] = [
  { platform: "windows", label: "Windows" },
  { platform: "macos", label: "macOS" },
  { platform: "linux", label: "Linux" },
  { platform: "chrome", label: "Chrome" },
  { platform: "firefox", label: "Firefox" },
];

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
  "Finish the hard coding session",
  "Write past the part that isn't fun",
  "Study without renegotiating",
  "Defend the same hours every week",
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
    body: "Set recurring windows and the block arms itself — even if the app is closed and you never remember to start it.",
  },
  {
    title: "Stop one impulsive click from ending the session",
    body: "Turning focus off asks the service to physically verify your paired key. No key in the machine, no unlock.",
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
        with no card and no time limit. Pro is {formatPriceUsd(PRO_ANNUAL_MONTHLY_EQUIVALENT_CENTS)}
        /month billed annually, or {formatPriceUsd(PRO_PRICE_CENTS.monthly)} billed monthly, and
        adds app blocking, recurring schedules, unlimited sites and unlimited profiles. New accounts
        get {PRO_TRIAL_DAYS} days of Pro free — see <Link href="/pricing">pricing</Link>.
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

/**
 * TEMPORARY: the testimonials are all placeholder copy, so production hides the section rather
 * than publishing invented social proof. Development keeps it so the slot stays visible. Remove
 * this flag once real customer quotes exist.
 */
const showTestimonials = config.app.environment !== "production";

export default function LandingPage() {
  return (
    <>
      <section className="hero">
        <h1 className="hero__headline">Make your computer a place for work again</h1>
        <p className="hero__eyebrow">
          A distraction blocker that works on the device where you do real work
        </p>

        <HeroDemo />

        <div className="hero__sub">
          <p>
            {config.app.name} is a unique distraction blocker that only lets you turn it off if you
            have a paired USB drive inserted. This lets you create a physical barrier between you
            and everything else trying to steal your focus. Use any USB drive you already own.
          </p>
        </div>
        <div className="hero__ctas">
          <Link href="/download" className="landing__cta landing__cta--primary">
            Start focusing for free
          </Link>
          <a href="#demo" className="landing__cta landing__cta--secondary">
            Watch the 30-second demo
          </a>
        </div>
        <p className="hero__trial">
          Free forever for {FREE_BLOCKED_SITE_LIMIT} sites · or try{" "}
          <Link href="/pricing">Pro free for {PRO_TRIAL_DAYS} days</Link>
        </p>
        <ul className="compat" aria-label="Supported platforms">
          {platforms.map(({ platform, label }) => (
            <li key={platform} className="compat__item">
              <PlatformIcon platform={platform} size={16} />
              <span>{label}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="section recognition">
        <h2 className="section__title">You&apos;ve already tried blocking distractions</h2>
        <div className="recognition__copy">
          <p>You installed the browser extensions. You set the timers. But they never stuck.</p>
          <p>
            The work got hard, you disabled the blocker, and YouTube was open again before you had
            consciously decided to stop working.
          </p>
          <p className="recognition__turn">
            The blocker did exactly what you told it to. The problem isn&apos;t that it can&apos;t
            block websites — it&apos;s that quitting is still one click away.
          </p>
        </div>
      </section>

      {/* The named idea the rest of the page hangs on. Everything above is the visitor's
          experience; this is the diagnosis they haven't put into words yet. */}
      <section className="section diagnosis">
        <div className="diagnosis__lead">
          <div className="diagnosis__copy">
            <h2 className="section__title">The off switch is the problem</h2>
            <p>
              Every other blocker is controlled from the computer it&apos;s supposed to be
              protecting. The distracted version of you can undo the decision the focused version
              made ten minutes ago, with the same mouse, in the same three clicks.
            </p>
            <p>
              {config.app.name} moves that decision into the physical world. Turning off the blocker
              means going and getting your key — still possible when you genuinely need to stop, no
              longer effortless enough to happen on autopilot.
            </p>
            <p className="diagnosis__thesis">
              It doesn&apos;t ask you to have more discipline. It gives the version of you that was
              thinking clearly some leverage over the one who shows up when the work gets hard.
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

      <section className="section" id="how">
        <h2 className="section__title">Easy to use</h2>
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

      <section className="section">
        <h2 className="section__title">Stay focused even when the work gets hard</h2>
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
        <h2 className="section__title">Block distractions without blocking your work</h2>
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
        <div className="split__grid">
          <div className="split__col">
            <h3>Free, forever</h3>
            <p>
              {FREE_BLOCKED_SITE_LIMIT} blocked websites, allow-only and block-all modes, manual
              focus sessions, and the key requirement to end one early.
            </p>
          </div>
          <div className="split__col">
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

      {showTestimonials ? (
        <section className="section proof">
          <h2 className="section__title">From people who kept using it</h2>
          <p className="section__lede">
            The claim isn&apos;t that a physical key works for one session. It&apos;s that it keeps
            working after the novelty wears off — so the proof here should be measured in weeks.
          </p>
          <div className="proof__grid">
            <blockquote className="quote">
              <p>
                &ldquo;Other blockers were easy to turn off. {config.app.name} made giving up
                inconvenient enough that I went back to work.&rdquo;
              </p>
              <footer>
                <MediaPlaceholder
                  ratio="1 / 1"
                  kind="photo"
                  label="Headshot"
                  className="quote__avatar"
                />
                <span className="quote__attribution">
                  Placeholder — replace with a real customer: name, role, the blockers they tried
                  before, what they were avoiding, and how many weeks they&apos;ve used{" "}
                  {config.app.name}.
                </span>
              </footer>
            </blockquote>
            <MediaPlaceholder
              ratio="16 / 10"
              kind="case study"
              label="Customer story: the developer"
              note="Stopped opening YouTube between hard coding tasks. Needs: previous blockers tried, sessions completed, weeks of use, work shipped."
            />
            <MediaPlaceholder
              ratio="16 / 10"
              kind="case study"
              label="Customer story: the writer"
              note="Protected a two-hour morning block. Same shape of proof: before, during, how long it lasted."
            />
          </div>
        </section>
      ) : null}

      <section className="section faq" id="faq">
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
        <h2>Take back your attention and go fulfill your destiny.</h2>
        <Link href="/download" className="landing__cta landing__cta--primary">
          Start focusing free
        </Link>
        <p className="cta-band__note">
          Free forever, no card. Want schedules and app blocking?{" "}
          <Link href="/pricing">Try Pro free for {PRO_TRIAL_DAYS} days</Link>.
        </p>
      </section>
    </>
  );
}
