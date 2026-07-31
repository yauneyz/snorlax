import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthenticatedUiRoute } from "@/lib/auth/require-authenticated-ui-route";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

const setupSteps = [
  {
    title: "Install the desktop app",
    body: "It carries the privileged service that does the actual enforcing. Grab the build for your operating system.",
  },
  {
    title: "Add the browser extension",
    body: "Required for web blocking. Install it in every browser you use so nothing slips through.",
  },
  {
    title: "Pair your USB key",
    body: "Pair any USB drive in the app, start a focus session, and unplug the key. Until it's back — or the session ends — the block holds.",
  },
];

export default async function AppPage() {
  const { user } = await requireAuthenticatedUiRoute();

  return (
    <section className="dashboard">
      <h1>Welcome to {config.app.name}</h1>
      <p>You are signed in as {user.email}.</p>

      <section className="dashboard__panel">
        <h2>Get set up</h2>
        <ol className="dashboard__steps">
          {setupSteps.map((step, index) => (
            <li key={step.title} className="dashboard__step">
              <span className="dashboard__step-number" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="dashboard__actions">
          <Link href="/download" className="dashboard__cta">
            Download {config.app.name}
          </Link>
          <Link href="/account" className="dashboard__link">
            Manage account &amp; billing
          </Link>
        </div>
      </section>
    </section>
  );
}
