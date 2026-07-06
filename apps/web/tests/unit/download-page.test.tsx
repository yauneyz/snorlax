// @vitest-environment node
// Server component: render in node so config exposes the server-only store URLs.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import DownloadPage from "@/app/(marketing)/download/page";
import { config } from "@/lib/config";

describe("download page", () => {
  const html = renderToStaticMarkup(<DownloadPage />);

  it("links every desktop platform to the download API route", () => {
    for (const platform of ["win", "mac", "linux"]) {
      expect(html).toContain(`href="/api/desktop/download?platform=${platform}"`);
    }
    expect(html).not.toMatch(/AppImage/i);
  });

  it("links browser extensions to their configured store URLs", () => {
    // setup.ts provides non-empty store URLs, so no card should fall back to coming soon.
    for (const url of [
      config.extensionStores.chromeUrl,
      config.extensionStores.edgeUrl,
      config.extensionStores.firefoxUrl,
    ]) {
      expect(url).not.toBe("");
      expect(html).toContain(`href="${url}"`);
    }
    expect(html).not.toContain("Coming soon");
  });
});
