// @vitest-environment node
// Server component: render in node so `config.app.environment` reflects APP_ENVIRONMENT.
//
// The product media (hero demo + app screenshots) is real and ships in every environment.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const original = process.env.APP_ENVIRONMENT;

async function renderLanding(environment: "development" | "production") {
  process.env.APP_ENVIRONMENT = environment;
  vi.resetModules();
  const { default: LandingPage } = await import("@/app/(marketing)/page");
  return renderToStaticMarkup(<LandingPage />);
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env.APP_ENVIRONMENT = original;
  vi.resetModules();
});

describe("landing page media", () => {
  it("ships the demo video and every app screenshot in production", async () => {
    const html = await renderLanding("production");

    // The demo autoplays in the hero, so it must ship even without a "watch demo" CTA.
    expect(html).toContain('id="demo"');
    expect(html).toContain("/media/hero-demo.webm");
    expect(html).toContain("/media/hero-demo.mp4");
    expect(html).toContain("/media/hero-demo-poster.jpg");

    // One screenshot per step, plus the refusal beside the diagnosis.
    for (const shot of [
      "app-pair-key.png",
      "app-blocklist.png",
      "app-focused-key-away.png",
      "app-key-required.png",
    ]) {
      expect(html).toContain(encodeURIComponent(`/media/${shot}`));
    }

    // The layout variants that existed only to close the gap left by missing media.
    expect(html).not.toContain("hero--flat");
    expect(html).not.toContain("diagnosis--flat");
  });

  it("describes each screenshot for readers who can't see it", async () => {
    const html = await renderLanding("production");

    expect(html).toContain('alt="The Keys screen');
    expect(html).toContain('alt="The Blocklists screen');
    expect(html).toContain('alt="The dashboard mid-session');
    expect(html).not.toContain('alt=""');
  });

  it("leads with the physical-key mechanism without invented social proof", async () => {
    const html = await renderLanding("production");

    // The headline is split across spans and line breaks for layout; compare its text.
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("A distraction blocker you need a physical key to turn off.");
    expect(html).toContain("Start focusing in under 5 minutes - free");
    expect(html).not.toContain("From people who kept using it");
    expect(html).not.toContain("Placeholder — replace with a real customer");
  });
});
