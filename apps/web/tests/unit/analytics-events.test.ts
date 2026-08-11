import { describe, expect, it } from "vitest";
import {
  ANALYTICS_EVENT_NAMES,
  MAX_PROPS_KEYS,
  analyticsEventName,
  isPosthogFanoutEvent,
  parseEventProps,
} from "@/lib/analytics/events";

describe("the event allowlist", () => {
  it("rejects an unknown event name", () => {
    // §14: the main defence against a junk-filled fact table, since the ingest endpoint is
    // public and unauthenticated. It doubles as a typo catcher during development.
    expect(analyticsEventName.safeParse("page_view").success).toBe(false);
    expect(analyticsEventName.safeParse("account_created").success).toBe(true);
  });

  it("has no duplicate names", () => {
    expect(new Set(ANALYTICS_EVENT_NAMES).size).toBe(ANALYTICS_EVENT_NAMES.length);
  });

  it("names every event object_verb_past in snake_case", () => {
    for (const name of ANALYTICS_EVENT_NAMES) {
      expect(name, `${name} should be snake_case`).toMatch(/^[a-z]+(_[a-z]+)+$/);
    }
  });
});

describe("parseEventProps", () => {
  it("accepts a valid payload for a declared event", () => {
    const result = parseEventProps("download_clicked", { platform: "linux" });
    expect(result.ok).toBe(true);
  });

  it("rejects an invalid enum value", () => {
    const result = parseEventProps("download_clicked", { platform: "solaris" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("props.platform");
  });

  it("rejects a non-integer session_index", () => {
    // This is the other half of the regex guard in the analytics_funnel view: a string here
    // would make the whole view raise on every query once it reached the table.
    const bad = parseEventProps("focus_session_completed", {
      duration_s: 60,
      source: "user",
      ended_by: "completed",
      session_index: "two",
    });
    expect(bad.ok).toBe(false);
  });

  it("caps the number of props keys", () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: MAX_PROPS_KEYS + 1 }, (_, i) => [`k${i}`, i]),
    );
    const result = parseEventProps("signed_in", tooMany);
    expect(result.ok).toBe(false);
  });

  it("allows undeclared events through with arbitrary props", () => {
    const result = parseEventProps("subscription_started", { plan: "yearly" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.props).toEqual({ plan: "yearly" });
  });

  it("preserves extra keys alongside declared ones", () => {
    const result = parseEventProps("download_clicked", { platform: "win", referrer: "x" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.props.referrer).toBe("x");
  });

  it("treats missing props as an empty object", () => {
    expect(parseEventProps("signed_in", undefined).ok).toBe(true);
  });
});

describe("isPosthogFanoutEvent", () => {
  it("sends web events to PostHog but keeps desktop and server events in Supabase only", () => {
    // §3: rollups are not events and per-event pricing punishes usage data, so tier 2 and
    // desktop signals stay in the system of record.
    expect(isPosthogFanoutEvent("web")).toBe(true);
    expect(isPosthogFanoutEvent("desktop")).toBe(false);
    expect(isPosthogFanoutEvent("server")).toBe(false);
  });
});
