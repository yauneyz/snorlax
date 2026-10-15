import type { Metadata } from "next";
import { DownloadCard } from "@/components/marketing/DownloadCard";
import { config } from "@/lib/config";
import { extensionTargets } from "@/lib/extension-stores";

export const metadata: Metadata = {
  title: "Welcome",
  robots: { index: false, follow: false },
};

/**
 * Opened once by the desktop app on a new install's first launch, through
 * /api/desktop/bridge?d=<device_id>&to=…/welcome (apps/desktop/src/main/analyticsBridge.ts).
 * That hop is what joins the install to the browser that downloaded it; this page is the
 * onboarding step that makes opening a browser worth it: adding the extension.
 */
export default function WelcomePage() {
  return (
    <section className="download">
      <header className="download__header">
        <p className="section__eyebrow">{config.app.name} is installed</p>
        <h1 className="download__headline">
          One more piece:
          <br />
          the browser.
        </h1>
        <p className="download__lede">
          The desktop app enforces your sessions across the whole computer. The extension does the
          site blocking inside the browser, and lets {config.app.name} confirm the browser is
          covered. Add it to every browser you use.
        </p>
      </header>

      <div className="download__group">
        <div className="download__group-head">
          <span className="download__step">STEP 02</span>
          <h2>Add the browser extension</h2>
          <p>
            The extension connects to the desktop app by itself. The app&rsquo;s setup screen
            turns green when it does.
          </p>
        </div>
        <div className="download-grid">
          {extensionTargets.map((target) => (
            <DownloadCard key={target.platform} target={target} />
          ))}
        </div>
      </div>

      <aside className="download__next">
        <div>
          <span className="download__step">STEP 03</span>
          <h2>Back in the app: pair a drive.</h2>
          <p>
            Plug in any USB drive you own and pair it in {config.app.name}. Then put it in another
            room, and start a session.
          </p>
        </div>
      </aside>
    </section>
  );
}
