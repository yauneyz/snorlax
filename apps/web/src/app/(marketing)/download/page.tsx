import type { Metadata } from "next";
import { DetectedPlatform } from "@/components/marketing/DetectedPlatform";
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
  chrome:
    "https://chromewebstore.google.com/detail/talysman/jblidbjafmpbpednomngbbmpkihedeko",
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

function DownloadCard({ target }: { target: DownloadTarget }) {
  return (
    <a
      className="download-card"
      href={target.href}
      {...(target.external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      <span className="download-card__icon">
        <PlatformIcon platform={target.platform} size={22} />
      </span>
      <h3>{target.name}</h3>
      <span className="download-card__note">{target.note}</span>
    </a>
  );
}

export default function DownloadPage() {
  return (
    <section className="download">
      <header className="download__header">
        <h1 className="download__headline">Download {config.app.name}</h1>
        <p className="download__lede">
          Install the desktop app first — it carries the privileged service that does the actual
          enforcing. Then add the browser extension to every browser you use.
        </p>
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
          <h2>Desktop app</h2>
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
          <h2>Make sure you also get the browser extension</h2>
          <p>
            The extension improves web blocking accuracy. In addition, it allows you to enable
            &ldquo;strict mode&rdquo; where any browser that isn&apos;t running the extension gets
            automatically closed. Forcing the extension to be active closes off various ways to
            sneak around {config.app.name}&apos;s filtering.
          </p>
        </div>
        <div className="download-grid">
          {extensions.map((target) => (
            <DownloadCard key={target.platform} target={target} />
          ))}
        </div>
      </div>

    </section>
  );
}
