"use client";

import { useEffect, useState } from "react";
import { sendGAEvent } from "@next/third-parties/google";

type PlatformKey = "win" | "mac" | "linux";
type Detected = { key: PlatformKey; label: string; href: string };

const byPlatform: Record<PlatformKey, Detected> = {
  win: { key: "win", label: "Windows", href: "/api/desktop/download?platform=win" },
  mac: { key: "mac", label: "macOS", href: "/api/desktop/download?platform=mac" },
  linux: { key: "linux", label: "Linux", href: "/api/desktop/download?platform=linux" },
};

function detect(userAgent: string): Detected | null {
  if (/windows|win32|win64/i.test(userAgent)) return byPlatform.win;
  // Order matters: iPadOS reports a Mac-like UA, and "like Mac OS X" appears on iOS too.
  if (/mac os x|macintosh/i.test(userAgent) && !/iphone|ipad|ipod/i.test(userAgent)) {
    return byPlatform.mac;
  }
  if (/linux/i.test(userAgent) && !/android/i.test(userAgent)) return byPlatform.linux;
  return null;
}

/**
 * The "we think you're on X" banner above the platform grid. Renders nothing until mounted so
 * the server and client markup agree, and nothing at all on mobile or an unknown UA — the
 * grid below it is the fallback.
 *
 * The glyphs arrive pre-rendered from the server page rather than being imported here, so the
 * Font Awesome icon data stays out of the client bundle.
 */
export function DetectedPlatform({ icons }: { icons: Record<PlatformKey, React.ReactNode> }) {
  const [detected, setDetected] = useState<Detected | null>(null);

  useEffect(() => {
    setDetected(detect(navigator.userAgent));
  }, []);

  if (!detected) return null;

  return (
    <div className="detected-platform">
      <div className="detected-platform__banner">
        <span className="detected-platform__icon" aria-hidden="true">
          {icons[detected.key]}
        </span>
        <p className="detected-platform__text">
          <span className="detected-platform__eyebrow">RECOMMENDED DOWNLOAD</span>
          <span className="detected-platform__name">{detected.label} desktop app</span>
        </p>
        <a
          className="detected-platform__link"
          href={detected.href}
          onClick={() => sendGAEvent("event", "download", { platform: detected.key })}
        >
          Download for {detected.label}
        </a>
      </div>
    </div>
  );
}
