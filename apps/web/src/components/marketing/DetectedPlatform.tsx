"use client";

import { useEffect, useState } from "react";

type Detected = { label: string; href: string };

const byPlatform: Record<string, Detected> = {
  win: { label: "Windows", href: "/api/desktop/download?platform=win" },
  mac: { label: "macOS", href: "/api/desktop/download?platform=mac" },
  linux: { label: "Linux", href: "/api/desktop/download?platform=linux" },
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
 * The "we think you're on X" pill above the platform grid. Renders nothing until mounted so
 * the server and client markup agree, and nothing at all on mobile or an unknown UA — the
 * grid below it is the fallback.
 */
export function DetectedPlatform() {
  const [detected, setDetected] = useState<Detected | null>(null);

  useEffect(() => {
    setDetected(detect(navigator.userAgent));
  }, []);

  if (!detected) return null;

  return (
    <div className="detected-platform">
      <p>
        Looks like you&apos;re on {detected.label}
        <a className="detected-platform__link" href={detected.href}>
          Download for {detected.label}
        </a>
      </p>
    </div>
  );
}
