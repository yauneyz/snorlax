import type { Metadata } from "next";
import Link from "next/link";
import { TalysmanMark } from "@/components/brand/TalysmanMark";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Home",
  description: `${config.app.name} is a distraction blocker you can't talk your way out of — enforcement runs in a privileged service, and unlocking early takes your paired USB key.`,
  alternates: { canonical: `${config.app.url}/` },
};

const pillars = [
  {
    title: "Killing the app changes nothing",
    body: "Blocking never runs in the window you're looking at. A privileged background service holds the real focus state, auto-restarts if stopped, and survives reboots.",
  },
  {
    title: "Unlocking takes the key",
    body: "To end a locked session early, the service re-checks your physical USB key itself. The UI's claim is never trusted — no key present, no unlock.",
  },
  {
    title: "Below the easy workarounds",
    body: "DNS is intercepted at the packet layer, so editing hosts, switching resolvers, or pointing at a raw IP doesn't get you through. DoT and known DoH endpoints are blocked too.",
  },
  {
    title: "Sites, apps, and schedules",
    body: "Blacklist the handful of sites that eat your day, or block everything but your allowlist. Set recurring windows so focus starts without you deciding to start it.",
  },
];

const steps = [
  {
    title: "Install and pair a key",
    body: "Install the desktop app and the browser extension, then pair any USB drive you own. It becomes the only thing that ends a session early.",
  },
  {
    title: "Set your policy",
    body: "Pick blacklist, allowlist, or block-all. Add sites and apps, and set the schedule you want to be protected from yourself on.",
  },
  {
    title: "Start focus and walk away",
    body: "Unplug the key and put it somewhere inconvenient. Until it's back, or the session ends, the block holds.",
  },
];

export default function LandingPage() {
  return (
    <>
      <section className="hero">
        <div className="hero__glow" aria-hidden="true">
          <TalysmanMark size={420} />
        </div>
        <p className="hero__eyebrow">Windows &amp; macOS · Free plan available</p>
        <h1 className="hero__headline">Willpower is a bad security model.</h1>
        <p className="hero__sub">
          {config.app.name} blocks the sites and apps that eat your day — and keeps blocking them
          after you change your mind. Enforcement lives in a privileged service, not in a window
          you can close, and ending a session early takes the USB key you paired.
        </p>
        <div className="hero__ctas">
          <Link href="/download" className="landing__cta landing__cta--primary">
            Download {config.app.name}
          </Link>
          <Link href="/pricing" className="landing__cta landing__cta--secondary">
            See pricing
          </Link>
        </div>
        <p className="hero__note">Free to start. No card required until you want Pro.</p>
      </section>

      <section className="section" id="why">
        <h2 className="section__title">Built so cheating costs more than working</h2>
        <p className="section__lede">
          Every blocker works until the moment you want it not to. {config.app.name} is designed
          for that moment.
        </p>
        <div className="pillar-grid">
          {pillars.map((pillar) => (
            <article key={pillar.title} className="pillar-card">
              <h3>{pillar.title}</h3>
              <p>{pillar.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section" id="how">
        <h2 className="section__title">How it works</h2>
        <ol className="steps">
          {steps.map((step, index) => (
            <li key={step.title} className="step">
              <span className="step__number" aria-hidden="true">
                {index + 1}
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section honesty">
        <h2 className="section__title">What we won&apos;t claim</h2>
        <p className="section__lede">
          Nothing on a machine you administer is unbreakable, and a blocker that pretends
          otherwise is lying to you. A determined admin can boot into safe mode and dig the
          service out. The goal isn&apos;t to make that impossible — it&apos;s to make it more
          work than the thing you were supposed to be doing.
        </p>
      </section>

      <section className="cta-band">
        <h2>Stop negotiating with yourself.</h2>
        <p>Install the desktop app and the browser extension, and get your afternoon back.</p>
        <div className="hero__ctas">
          <Link href="/download" className="landing__cta landing__cta--primary">
            Get {config.app.name}
          </Link>
        </div>
      </section>
    </>
  );
}
