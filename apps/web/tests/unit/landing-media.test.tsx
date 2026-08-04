// @vitest-environment node
// Server component: render in node so `config.app.environment` reflects APP_ENVIRONMENT.
//
// TEMPORARY, paired with the `showMediaPlaceholders` / `showTestimonials` flags: until the
// artwork and real customer quotes exist, production must not ship labelled empty boxes or
// invented social proof. Delete this file when those flags go.
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

describe("landing page media and testimonials", () => {
  it("keeps the placeholders and the proof section in development", async () => {
    const html = await renderLanding("development");

    expect(html).toContain("media-slot");
    expect(html).toContain("From people who kept using it");
    expect(html).toContain("Watch the 30-second demo");
    expect(html).toContain('id="demo"');
    expect(html).not.toContain("hero--flat");
  });

  it("drops every media slot and the proof section in production", async () => {
    const html = await renderLanding("production");

    expect(html).not.toContain("media-slot");
    expect(html).not.toContain("From people who kept using it");
    expect(html).not.toContain("Placeholder — replace with a real customer");

    // Copy that promises a video the page no longer has.
    expect(html).not.toContain("Watch the 30-second demo");
    expect(html).not.toContain('href="#demo"');
    expect(html).toContain("See how it works");

    // Single-column variants, so the vacated grid columns don't leave half-empty rows.
    expect(html).toContain("hero--flat");
    expect(html).toContain("diagnosis--flat");
  });
});
