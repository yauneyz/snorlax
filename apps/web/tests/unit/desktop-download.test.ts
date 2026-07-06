// @vitest-environment node
// The route reads server-only config; jsdom would take config's client branch.
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/api/desktop/download/route";
import { config } from "@/lib/config";

function request(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/desktop/download${query}`);
}

const expectedInstallers: Record<string, string> = {
  win: "Talysman-Setup.exe",
  mac: "Talysman.dmg",
  linux: "Talysman.deb",
};

describe("GET /api/desktop/download", () => {
  it.each(Object.entries(expectedInstallers))(
    "redirects platform=%s to the stable S3 installer URL",
    async (platform, file) => {
      const response = await GET(request(`?platform=${platform}`));
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        `${config.extensionHosting.publicS3BaseUrl.replace(/\/+$/, "")}/app/${file}`,
      );
    },
  );

  it.each(["freebsd", "deb", "appimage"])(
    "returns 404 for unsupported platform %s",
    async (platform) => {
      const response = await GET(request(`?platform=${platform}`));
      expect(response.status).toBe(404);
    },
  );

  it("returns 404 when platform is missing", async () => {
    const response = await GET(request(""));
    expect(response.status).toBe(404);
  });
});
