import type { Metadata } from "next";
import Link from "next/link";
import { PRO_TRIAL_DAYS } from "@talysman/product";
import { DetectedPlatform } from "@/components/marketing/DetectedPlatform";
import { DownloadCard } from "@/components/marketing/DownloadCard";
import { PlatformIcon, type Platform } from "@/components/marketing/PlatformIcon";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Download",
  description: `Get the ${config.app.name} desktop app and browser extension for Chrome and Firefox.`,
  alternates: { canonical: `${config.app.url}/download` },
};

/**
 * Published listings are the defaults; deployment config can override them if a listing moves.
 */
const storeUrls = {
  chrome: "https://chromewebstore.google.com/detail/talysman/jblidbjafmpbpednomngbbmpkihedeko",
  firefox: "https://addons.mozilla.org/en-US/firefox/addon/talysman/",
} as const;

type DownloadTarget = {
  platform: Platform;
  name: string;
  note: string;
  href: string;
  external?: boolean;
};

const desktopInstallers: DownloadTarget[] = [
  {
    platform: "windows",
    name: "Windows",
    note: "Windows 10/11 · 64-bit",
    href: "/api/desktop/download?platform=win",
  },
  {
    platform: "macos",
    name: "macOS",
    note: "Apple Silicon & Intel",
    href: "/api/desktop/download?platform=mac",
  },
  {
    platform: "linux",
    name: "Linux",
    note: ".deb · Debian/Ubuntu · x86-64",
    href: "/api/desktop/download?platform=linux",
  },
];

const extensions: DownloadTarget[] = [
  {
    platform: "chrome",
    name: "Chrome",
    note: "Chrome Web Store",
    href: config.extensionStores.chromeUrl || storeUrls.chrome,
    external: true,
  },
  {
    platform: "firefox",
    name: "Firefox",
    note: "Firefox Browser Add-ons",
    href: config.extensionStores.firefoxUrl || storeUrls.firefox,
    external: true,
  },
];

export default function DownloadPage() {
  return (
    <section className="download">
      <header className="download__header">
        <p className="section__eyebrow">Your physical off switch starts here</p>
        <h1 className="download__headline">
          Put the off switch
          <br />
          in another room.
        </h1>
        <p className="download__lede">
          Install {config.app.name}, pair any USB drive you already own, and run a focus session
          that distracted-you cannot end with one impulsive click.
        </p>
        <ul className="download__promises" aria-label="Download assurances">
          <li>Free forever</li>
          <li>No account to install</li>
          <li>No proprietary hardware</li>
        </ul>
      </header>

      {/* Icons are rendered here, on the server, so the banner reuses the same marks as the
          cards without pulling the icon set into the client bundle. */}
      <DetectedPlatform
        icons={{
          win: <PlatformIcon platform="windows" size={22} />,
          mac: <PlatformIcon platform="macos" size={22} />,
          linux: <PlatformIcon platform="linux" size={22} />,
        }}
      />

      <div className="download__group">
        <div className="download__group-head">
          <span className="download__step">STEP 01</span>
          <h2>Install the desktop app</h2>
          <p>
            This is the enforcement layer. It keeps the session active if you close the window or
            restart your computer.
          </p>
        </div>
        <div className="download-grid">
          {desktopInstallers.map((target) => (
            <DownloadCard key={target.platform} target={target} />
          ))}
        </div>
        <aside className="download__windows-note" aria-labelledby="windows-download-note-title">
          <h3 id="windows-download-note-title">Windows might ask for confirmation</h3>
          <p>
            Microsoft Defender SmartScreen may call {config.app.name} an &ldquo;unrecognized
            app&rdquo; when you open it. That is a reputation warning, not a malware finding: this
            is a new app, and Windows has not seen enough downloads yet. If you see it, confirm the
            installer came from talysman.app before continuing.{" "}
            <a
              href="https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation"
              target="_blank"
              rel="noreferrer"
            >
              Why this happens
            </a>
          </p>
        </aside>
      </div>

      <div className="download__group">
        <div className="download__group-head">
          <span className="download__step">STEP 02</span>
          <h2>Add the browser extension</h2>
          <p>
            Add it to every browser you use for accurate site blocking. Strict mode can also close
            browsers that do not have the extension, removing the obvious workaround.
          </p>
        </div>
        <div className="download-grid">
          {extensions.map((target) => (
            <DownloadCard key={target.platform} target={target} />
          ))}
        </div>
      </div>

      <aside className="download__next">
        <div>
          <span className="download__step">STEP 03</span>
          <h2>Pair a drive. Put it away. Start the work.</h2>
          <p>
            Manual key-locked sessions are free forever. When you want recurring schedules and
            desktop app blocking, Pro is free for {PRO_TRIAL_DAYS} days.
          </p>
        </div>
        <Link href="/#how" className="landing__cta landing__cta--secondary">
          See the 3-step setup
        </Link>
      </aside>
    </section>
  );
}
