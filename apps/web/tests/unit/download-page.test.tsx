// @vitest-environment node
// Server component: render in node so config exposes the server-only store URLs.
import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import DownloadPage from "@/app/(marketing)/download/page";
import { config } from "@/lib/config";

async function render(searchParams: { from?: string } = {}) {
  return renderToStaticMarkup(await DownloadPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("download page", () => {
  let html = "";
  beforeAll(async () => {
    html = await render();
  });

  it("links every desktop platform to the download API route", () => {
    for (const platform of ["win", "mac", "linux"]) {
      expect(html).toContain(`href="/api/desktop/download?platform=${platform}"`);
    }
    expect(html).not.toMatch(/AppImage/i);
  });

  it("carries a search page's `from` on to the installer links", async () => {
    const tagged = await render({ from: "cold-turkey-alternative" });
    for (const platform of ["win", "mac", "linux"]) {
      expect(tagged).toContain(
        `href="/api/desktop/download?platform=${platform}&amp;from=cold-turkey-alternative"`,
      );
    }
  });

  it("drops a `from` that isn't a live search page", async () => {
    const tagged = await render({ from: "not-a-page" });
    expect(tagged).not.toContain("from=");
  });

  it("links browser extensions to their configured store URLs", () => {
    // setup.ts provides non-empty store URLs, so no card should fall back to coming soon.
    for (const url of [
      config.extensionStores.chromeUrl,
      config.extensionStores.firefoxUrl,
    ]) {
      expect(url).not.toBe("");
      expect(html).toContain(`href="${url}"`);
    }
    expect(html).not.toContain(config.extensionStores.edgeUrl);
    expect(html).not.toContain("Coming soon");
  });

  it("sets expectations for Windows SmartScreen reputation warnings", () => {
    expect(html).toContain("Windows might ask for confirmation");
    expect(html).toContain("That is a reputation warning, not a malware finding");
    expect(html).toContain("installer came from talysman.app before continuing");
    expect(html).toContain(
      'href="https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation"',
    );
  });
});
