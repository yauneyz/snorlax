"use client";

import { useEffect, useRef, useState } from "react";
import { sendGAEvent } from "@next/third-parties/google";
import { directHref, type DownloadTarget } from "@/lib/downloads";

/**
 * Starts the installer download once the post-download page is on screen. The POST is what
 * records the download (server-side, behind BotID), and returns the installer URL; navigating
 * to a file URL downloads it without leaving this page, so the install steps stay visible.
 *
 * Anything that goes wrong falls back to the untracked redirect: losing a data point is fine,
 * losing the download is not.
 */
export function DownloadStarter({
  target,
  from,
  fileName,
}: {
  target: DownloadTarget;
  from: string | null;
  fileName: string;
}) {
  const started = useRef(false);
  const [state, setState] = useState<"starting" | "started">("starting");
  const fallback = directHref(target, from);

  useEffect(() => {
    // StrictMode mounts effects twice in development; one download per page view.
    if (started.current) return;
    started.current = true;
    sendGAEvent("event", "download", { platform: target.platform });

    void (async () => {
      let url = fallback;
      try {
        const response = await fetch("/api/desktop/download", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ platform: target.platform, format: target.format, from }),
        });
        if (response.ok) {
          const body = (await response.json()) as { url?: unknown };
          if (typeof body.url === "string") url = body.url;
        }
      } catch {
        // Network trouble: the redirect below still delivers the installer.
      }
      window.location.assign(url);
      setState("started");
    })();
  }, [fallback, from, target.format, target.platform]);

  return (
    <p className="download-start__status" role="status">
      {state === "starting" ? "Starting your download…" : `Downloading ${fileName}.`}{" "}
      Nothing happening? <a href={fallback}>Download {fileName} directly</a>.
    </p>
  );
}
