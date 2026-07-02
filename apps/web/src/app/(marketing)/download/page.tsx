import type { Metadata } from "next";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Download",
  description: `Get the ${config.app.name} desktop app and browser extension.`,
  alternates: { canonical: `${config.app.url}/download` },
};

type DesktopInstaller = {
  os: string;
  note: string;
  href: string;
};

const desktopInstallers: DesktopInstaller[] = [
  { os: "Windows", note: "Windows 10/11 · 64-bit", href: "/api/desktop/download?platform=win" },
  { os: "macOS", note: "Apple Silicon & Intel", href: "/api/desktop/download?platform=mac" },
  { os: "Linux", note: "AppImage · x86-64", href: "/api/desktop/download?platform=linux" },
];

type ExtensionLink = {
  browser: string;
  note: string;
  href?: string;
  action: string;
};

const extensionLinks: ExtensionLink[] = [
  {
    browser: "Chrome",
    note: "Install from the Chrome Web Store",
    href: config.extensionStores.chromeUrl || undefined,
    action: "Add to Chrome",
  },
  {
    browser: "Edge",
    note: "Install from Microsoft Edge Add-ons",
    href: config.extensionStores.edgeUrl || undefined,
    action: "Add to Edge",
  },
  {
    browser: "Firefox",
    note: "Install from Firefox Add-ons",
    href: config.extensionStores.firefoxUrl || undefined,
    action: "Add to Firefox",
  },
];

export default function DownloadPage() {
  return (
    <section className="pricing">
      <h1>Download {config.app.name}</h1>
      <p className="pricing__lede">
        Install the desktop app, then add the browser extension. The extension is required for web
        blocking — when the dead-man’s switch is on, browsers without it are closed during a locked
        session.
      </p>

      <h2>Desktop app</h2>
      <div className="pricing-grid">
        {desktopInstallers.map((installer) => (
          <div key={installer.os} className="pricing-card">
            <h2>{installer.os}</h2>
            <p className="pricing-card__price">{installer.note}</p>
            <a className="landing__cta landing__cta--primary" href={installer.href}>
              Download
            </a>
          </div>
        ))}
      </div>

      <h2>Browser extension</h2>
      <div className="pricing-grid">
        {extensionLinks.map((ext) => (
          <div key={ext.browser} className="pricing-card">
            <h2>{ext.browser}</h2>
            <p className="pricing-card__price">{ext.note}</p>
            {ext.href ? (
              <a
                className="landing__cta landing__cta--primary"
                href={ext.href}
                target="_blank"
                rel="noreferrer"
              >
                {ext.action}
              </a>
            ) : (
              <span className="landing__cta landing__cta--primary" aria-disabled="true">
                Coming soon
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
