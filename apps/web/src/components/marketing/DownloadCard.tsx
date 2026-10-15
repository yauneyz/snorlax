"use client";

import { sendGAEvent } from "@next/third-parties/google";
import { PlatformIcon, type Platform } from "@/components/marketing/PlatformIcon";
import { LINUX_FORMATS, startHref, type LinuxFormat } from "@/lib/downloads";

type DownloadTarget = {
  platform: Platform;
  name: string;
  note: string;
  href: string;
  external?: boolean;
};

/**
 * Desktop cards lead to the post-download page and extension cards to store URLs, so GA never
 * sees the eventual installer navigation — fire the event on click instead.
 */
export function DownloadCard({ target }: { target: DownloadTarget }) {
  return (
    <a
      className="download-card"
      href={target.href}
      {...(target.external ? { target: "_blank", rel: "noreferrer" } : {})}
      onClick={() => sendGAEvent("event", "download", { platform: target.platform })}
    >
      <span className="download-card__icon">
        <PlatformIcon platform={target.platform} size={22} />
      </span>
      <h3>{target.name}</h3>
      <span className="download-card__note">{target.note}</span>
      <span className="download-card__action" aria-hidden="true">
        Download <span>→</span>
      </span>
    </a>
  );
}

/**
 * Linux ships three package formats, so its card is a panel of links rather than one whole-card
 * link (links can't nest).
 */
export function LinuxDownloadCard({ from }: { from: string | null }) {
  return (
    <div className="download-card download-card--multi">
      <span className="download-card__icon">
        <PlatformIcon platform="linux" size={22} />
      </span>
      <h3>Linux</h3>
      <span className="download-card__note">x86-64 · deb · rpm · pacman</span>
      <ul className="download-card__formats">
        {(Object.keys(LINUX_FORMATS) as LinuxFormat[]).map((format) => (
          <li key={format}>
            <a
              href={startHref({ platform: "linux", format }, from)}
              onClick={() => sendGAEvent("event", "download", { platform: "linux", format })}
            >
              <span className="download-card__format">{LINUX_FORMATS[format].label}</span>
              <span className="download-card__distros">{LINUX_FORMATS[format].distros}</span>
              <span aria-hidden="true">→</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
