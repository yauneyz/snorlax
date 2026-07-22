import type { Metadata } from "next";
import Link from "next/link";
import { TalysmanMark } from "@/components/brand/TalysmanMark";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Home",
  description: `${config.app.name} blocks distracting websites and apps on your computer. Turning it off requires a physical USB drive paired with the app.`,
  alternates: { canonical: `${config.app.url}/` },
};

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
        <h1 className="hero__headline">
          A distraction blocker that actually works, built for the device where your work actually
          happens
        </h1>
        <div className="hero__sub">
          <p>
            Most focus apps are for your phone. What about your computer, the place you actually
            get work done? {config.app.name} can block specific websites on desktop browsers and
            also blocks distracting apps.
          </p>
          <p>
            Even better, turning it off requires a physical USB drive that you pair with the app.
            Turning the blocker off is easy enough that you don&apos;t have to worry about
            emergencies, but hard enough that you won&apos;t just do it out of habit like you
            already do with your other blockers.
          </p>
          <p>{config.app.name} is built for getting real work done</p>
        </div>
        <div className="hero__ctas">
          <Link href="/download" className="landing__cta landing__cta--primary">
            Download {config.app.name}
          </Link>
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

    </>
  );
}
