// @vitest-environment node
// The route reads server-only config; jsdom would take config's client branch.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const track = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const checkBotId = vi.hoisted(() => vi.fn().mockResolvedValue({ isBot: false }));
vi.mock("@/server/analytics/track", () => ({ track }));
vi.mock("botid/server", () => ({ checkBotId }));
vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

import { GET, POST } from "@/app/api/desktop/download/route";
import { config } from "@/lib/config";

const base = config.extensionHosting.publicS3BaseUrl.replace(/\/+$/, "");
const HUMAN_UA = "Mozilla/5.0 (X11; Fedora; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";

function get(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/desktop/download${query}`);
}

function post(body: unknown, userAgent = HUMAN_UA): NextRequest {
  return new NextRequest("http://localhost:3000/api/desktop/download", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": userAgent },
    body: JSON.stringify(body),
  });
}

const expectedInstallers: Array<[string, string]> = [
  ["?platform=win", "Talysman-Setup.exe"],
  ["?platform=mac", "Talysman.dmg"],
  ["?platform=linux", "Talysman.deb"],
  ["?platform=linux&format=deb", "Talysman.deb"],
  ["?platform=linux&format=rpm", "Talysman.rpm"],
  ["?platform=linux&format=pacman", "Talysman.pacman"],
  // A format only means something on Linux.
  ["?platform=win&format=rpm", "Talysman-Setup.exe"],
];

beforeEach(() => {
  vi.clearAllMocks();
  checkBotId.mockResolvedValue({ isBot: false });
});

describe("GET /api/desktop/download", () => {
  it.each(expectedInstallers)("redirects %s to %s", async (query, file) => {
    const response = await GET(get(query));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${base}/app/${file}`);
  });

  it("does not record a download: anything can fetch a URL", async () => {
    await GET(get("?platform=mac"));
    expect(track).not.toHaveBeenCalled();
  });

  it.each(["?platform=freebsd", "?platform=deb", "?platform=linux&format=snap", ""])(
    "returns 404 for unsupported %s",
    async (query) => {
      const response = await GET(get(query));
      expect(response.status).toBe(404);
    },
  );
});

describe("POST /api/desktop/download", () => {
  it("records a verified human download and returns the installer URL", async () => {
    const response = await POST(post({ platform: "linux", format: "rpm" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: `${base}/app/Talysman.rpm` });
    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "download_clicked",
        source: "server",
        platform: "linux",
        props: expect.objectContaining({ platform: "linux", format: "rpm", ua_class: "human" }),
      }),
    );
  });

  it("keeps a live search page as the download's source and drops an unknown one", async () => {
    await POST(post({ platform: "win", from: "website-blocker-linux" }));
    expect(track.mock.calls[0]?.[0].props).toMatchObject({ from: "website-blocker-linux" });

    await POST(post({ platform: "win", from: "not-a-page" }));
    expect(track.mock.calls[1]?.[0].props).not.toHaveProperty("from");
  });

  it("still hands a BotID-flagged client the installer, but records nothing", async () => {
    checkBotId.mockResolvedValue({ isBot: true });
    const response = await POST(post({ platform: "mac" }));
    expect(await response.json()).toEqual({ url: `${base}/app/Talysman.dmg` });
    expect(track).not.toHaveBeenCalled();
  });

  it("does not record a self-declared crawler", async () => {
    await POST(post({ platform: "mac" }, "Mozilla/5.0 (compatible; Googlebot/2.1)"));
    expect(track).not.toHaveBeenCalled();
  });

  it("rejects an unknown platform or format", async () => {
    expect((await POST(post({ platform: "freebsd" }))).status).toBe(404);
    expect((await POST(post({ platform: "linux", format: "snap" }))).status).toBe(404);
    expect(track).not.toHaveBeenCalled();
  });
});
