"use client";

import { useEffect, useState } from "react";
import { sendGAEvent } from "@next/third-parties/google";
import { LINUX_FORMATS, startHref, type DownloadTarget } from "@/lib/downloads";

type PlatformKey = "win" | "mac" | "linux";
type Detected = { key: PlatformKey; label: string; target: DownloadTarget };

function detect(userAgent: string): Detected | null {
  if (/windows|win32|win64/i.test(userAgent)) {
    return { key: "win", label: "Windows", target: { platform: "win", format: null } };
  }
  // Order matters: iPadOS reports a Mac-like UA, and "like Mac OS X" appears on iOS too.
  if (/mac os x|macintosh/i.test(userAgent) && !/iphone|ipad|ipod/i.test(userAgent)) {
    return { key: "mac", label: "macOS", target: { platform: "mac", format: null } };
  }
  if (/linux/i.test(userAgent) && !/android/i.test(userAgent)) {
    // Distro builds of Firefox name the distro ("X11; Fedora; Linux x86_64"); anything we
    // can't place gets the .deb, the most common, with the other formats one click away below.
    const format = /fedora|red hat|opensuse|suse/i.test(userAgent) ? "rpm" : "deb";
    return {
      key: "linux",
      label: `Linux (${LINUX_FORMATS[format].label})`,
      target: { platform: "linux", format },
    };
  }
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
export function DetectedPlatform({
  icons,
  from,
}: {
  icons: Record<PlatformKey, React.ReactNode>;
  /** The search page whose CTA led here, carried on to the post-download page. */
  from: string | null;
}) {
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
          href={startHref(detected.target, from)}
          onClick={() => sendGAEvent("event", "download", { platform: detected.key })}
        >
          Download for {detected.label}
        </a>
      </div>
    </div>
  );
}
