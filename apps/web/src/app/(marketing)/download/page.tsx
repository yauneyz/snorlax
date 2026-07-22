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
 * Placeholder listings so the page reads as finished before the stores approve us. The
 * real URLs arrive via EXTENSION_*_STORE_URL and take precedence over these.
 */
const placeholderStoreUrls = {
  chrome: "https://chromewebstore.google.com/detail/talysman/example-chrome-id",
  firefox: "https://addons.mozilla.org/en-US/firefox/addon/talysman-example/",
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
    href: config.extensionStores.chromeUrl || placeholderStoreUrls.chrome,
    external: true,
  },
  {
    platform: "firefox",
    name: "Firefox",
    note: "Firefox Browser Add-ons",
    href: config.extensionStores.firefoxUrl || placeholderStoreUrls.firefox,
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
        <PlatformIcon platform={target.platform} />
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

      <DetectedPlatform />

      <div className="download__group">
        <div className="download__group-head">
          <h2>Desktop app</h2>
        </div>
        <div className="download-grid">
          {desktopInstallers.map((target) => (
            <DownloadCard key={target.platform} target={target} />
          ))}
        </div>
      </div>

      <div className="download__group">
        <div className="download__group-head">
          <h2>Make sure you also get the browser extension</h2>
          <p>
            Required for web blocking. When the dead-man&apos;s switch is on, browsers without the
            extension are closed during a locked session.
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
