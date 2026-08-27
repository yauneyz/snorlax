"use client";

import { sendGAEvent } from "@next/third-parties/google";
import { PlatformIcon, type Platform } from "@/components/marketing/PlatformIcon";

type DownloadTarget = {
  platform: Platform;
  name: string;
  note: string;
  href: string;
  external?: boolean;
};

/**
 * The desktop/extension installer links are server-side redirects (desktop) or store URLs
 * (extensions), so GA never sees the eventual navigation — fire the event on click instead.
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
