/**
 * Contract tests for migration 0006_analytics.sql, run against the local Supabase stack.
 *
 * These live in the integration suite (`pnpm web:test:webhook`) rather than the unit suite
 * because the behaviour under test IS the SQL — the identity merge, the idempotent usage
 * upsert, and the grants. §14 of analytics-arch.md asks for a unit test of the merge path;
 * a merge is inherently a multi-statement database operation, so this is the honest place
 * for it.
 *
 * Self-skips when the local stack is not running, following the convention in
 * `tests/e2e/redeem.spec.ts`.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.ANALYTICS_DEV_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secret = process.env.ANALYTICS_DEV_SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SECRET_KEY ?? "";

function isLocal(value: string): boolean {
  try {
    const host = new URL(value).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

let reachable = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: SupabaseClient<any>;

beforeAll(async () => {
  if (!url || !secret || !isLocal(url)) return;
  db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await db.from("analytics_events").select("id", { head: true, count: "exact" });
  reachable = !error;
});

const withStack = () =>
  reachable
    ? undefined
    : "local Supabase not reachable — run `supabase start --workdir apps/web` and `pnpm sync:env`";

describe("analytics_link", () => {
  it("creates one person per new identifier and is idempotent", async () => {
    if (withStack()) return;
    const anon = randomUUID();
    const { data: first, error: e1 } = await db.rpc("analytics_link", {
      p_identifiers: [`anon:${anon}`],
    });
    expect(e1).toBeNull();
    expect(first).toBeTruthy();

    const { data: second } = await db.rpc("analytics_link", { p_identifiers: [`anon:${anon}`] });
    expect(second).toBe(first);
  });

  it("merges two persons when identifiers bridge them, WITHOUT losing identity edges", async () => {
    if (withStack()) return;
    const anon = randomUUID();
    const device = randomUUID();
    const { data: pa } = await db.rpc("analytics_link", { p_identifiers: [`anon:${anon}`] });
    const { data: pd } = await db.rpc("analytics_link", { p_identifiers: [`device:${device}`] });
    expect(pa).not.toBe(pd);

    const { data: merged } = await db.rpc("analytics_link", {
      p_identifiers: [`anon:${anon}`, `device:${device}`],
    });
    expect([pa, pd]).toContain(merged);

    // The regression that matters: analytics_identities cascades on person delete, so a
    // careless merge silently deletes the loser's edge instead of repointing it.
    const { data: edges } = await db
      .from("analytics_identities")
      .select("identifier")
      .in("identifier", [`anon:${anon}`, `device:${device}`]);
    expect(edges).toHaveLength(2);
    expect(new Set((edges ?? []).map((e: { identifier: string }) => e.identifier))).toEqual(
      new Set([`anon:${anon}`, `device:${device}`]),
    );

    const { data: survivors } = await db
      .from("analytics_persons")
      .select("id")
      .in("id", [pa as string, pd as string]);
    expect(survivors).toHaveLength(1);
  });

  it("records first-touch attribution once and moves last-touch", async () => {
    if (withStack()) return;
    const anon = randomUUID();
    await db.rpc("analytics_link", {
      p_identifiers: [`anon:${anon}`],
      p_attribution: { utm_source: "reddit", utm_medium: "social", landing_path: "/" },
    });
    await db.rpc("analytics_link", {
      p_identifiers: [`anon:${anon}`],
      p_attribution: { utm_source: "google", utm_medium: "cpc" },
    });
    // A later direct visit with no campaign must not erase what we already learned.
    const { data: person } = await db.rpc("analytics_link", {
      p_identifiers: [`anon:${anon}`],
      p_attribution: {},
    });

    const { data: row } = await db
      .from("analytics_persons")
      .select("first_utm_source, first_landing_path, last_utm_source")
      .eq("id", person as string)
      .single();
    expect(row?.first_utm_source).toBe("reddit");
    expect(row?.first_landing_path).toBe("/");
    expect(row?.last_utm_source).toBe("google");
  });
});

describe("analytics_report_usage", () => {
  it("accepts a partial row, applying column defaults rather than failing not-null", async () => {
    if (withStack()) return;
    // The doc's `insert ... select *` inserted explicit NULLs here, which bypass defaults
    // and raise 23502 on app_opens. Every real desktop row is partial, so this was fatal.
    const device = randomUUID();
    const { data: n, error } = await db.rpc("analytics_report_usage", {
      p_rows: [
        {
          device_id: device,
          local_date: "2026-08-01",
          tz_offset_minutes: -420,
          platform: "linux",
          focus_seconds: 3600,
        },
      ],
    });
    expect(error).toBeNull();
    expect(n).toBe(1);

    const { data: row } = await db
      .from("analytics_usage_daily")
      .select("focus_seconds, app_opens, sessions_completed, extension_connected, reported_at")
      .eq("device_id", device)
      .single();
    expect(row?.focus_seconds).toBe(3600);
    expect(row?.app_opens).toBe(0);
    expect(row?.extension_connected).toBe(false);
    expect(row?.reported_at).toBeTruthy();
  });

  it("is idempotent under replay and cannot be regressed by a stale batch", async () => {
    if (withStack()) return;
    const device = randomUUID();
    const row = (focus: number, opens: number) => ({
      device_id: device,
      local_date: "2026-08-03",
      tz_offset_minutes: 0,
      platform: "win",
      focus_seconds: focus,
      app_opens: opens,
    });

    await db.rpc("analytics_report_usage", { p_rows: [row(3600, 2)] });
    await db.rpc("analytics_report_usage", { p_rows: [row(3600, 2)] }); // exact replay
    await db.rpc("analytics_report_usage", { p_rows: [row(100, 1)] }); // stale, arriving late

    const { data: after } = await db
      .from("analytics_usage_daily")
      .select("focus_seconds, app_opens")
      .eq("device_id", device)
      .single();
    expect(after?.focus_seconds).toBe(3600);
    expect(after?.app_opens).toBe(2);

    await db.rpc("analytics_report_usage", { p_rows: [row(7200, 5)] }); // genuinely fresher
    const { data: advanced } = await db
      .from("analytics_usage_daily")
      .select("focus_seconds, app_opens")
      .eq("device_id", device)
      .single();
    expect(advanced?.focus_seconds).toBe(7200);
    expect(advanced?.app_opens).toBe(5);
  });

  it("collapses duplicate (device_id, local_date) pairs inside one batch", async () => {
    if (withStack()) return;
    // Raw ON CONFLICT DO UPDATE raises 21000 "cannot affect row a second time" here.
    const device = randomUUID();
    const base = { device_id: device, local_date: "2026-08-04", tz_offset_minutes: 0, platform: "mac" };
    const { data: n, error } = await db.rpc("analytics_report_usage", {
      p_rows: [
        { ...base, focus_seconds: 60 },
        { ...base, focus_seconds: 900 },
      ],
    });
    expect(error).toBeNull();
    expect(n).toBe(1);

    const { data: row } = await db
      .from("analytics_usage_daily")
      .select("focus_seconds")
      .eq("device_id", device)
      .single();
    expect(row?.focus_seconds).toBe(900);
  });

  it("backfills a week of catch-up rows in one call", async () => {
    if (withStack()) return;
    // §6.5: a device that runs the blocker daily but never opens the UI reports nothing for
    // a week, then backfills all seven days at once.
    const device = randomUUID();
    const rows = Array.from({ length: 7 }, (_, i) => ({
      device_id: device,
      local_date: `2026-07-${String(10 + i).padStart(2, "0")}`,
      tz_offset_minutes: 0,
      platform: "linux",
      focus_seconds: 600 + i * 60,
    }));
    const { data: n } = await db.rpc("analytics_report_usage", { p_rows: rows });
    expect(n).toBe(7);
  });
});

describe("views", () => {
  it("analytics_funnel survives an uncastable session_index from the public endpoint", async () => {
    if (withStack()) return;
    const anon = randomUUID();
    await db.rpc("analytics_link", { p_identifiers: [`anon:${anon}`] });
    const { error: insertError } = await db.from("analytics_events").insert([
      {
        event: "focus_session_completed",
        occurred_at: new Date().toISOString(),
        anon_id: anon,
        source: "desktop",
        props: { session_index: "not-a-number" },
      },
      {
        event: "focus_session_completed",
        occurred_at: new Date().toISOString(),
        anon_id: anon,
        source: "desktop",
        props: { session_index: 1 },
      },
    ]);
    expect(insertError).toBeNull();

    // Without the regex guard in the view, this select raises for EVERY row, not just the
    // bad one — one junk prop would take the whole funnel panel down.
    const { data, error } = await db.from("analytics_funnel").select("person_id, first_session_at");
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });

  it("analytics_dau is queryable", async () => {
    if (withStack()) return;
    const { error } = await db.from("analytics_dau").select("local_date, dau_protected").limit(5);
    expect(error).toBeNull();
  });

  it("resolves events to the merged person through analytics_events_resolved", async () => {
    if (withStack()) return;
    const anon = randomUUID();
    const device = randomUUID();
    await db.rpc("analytics_link", { p_identifiers: [`anon:${anon}`] });
    await db.from("analytics_events").insert({
      event: "page_viewed",
      occurred_at: new Date().toISOString(),
      anon_id: anon,
      source: "web",
      props: { path: "/" },
    });
    const { data: merged } = await db.rpc("analytics_link", {
      p_identifiers: [`anon:${anon}`, `device:${device}`],
    });

    // The event row was written before the merge and carries no person_id; it must still
    // resolve to the surviving person with no backfill.
    const { data } = await db
      .from("analytics_events_resolved")
      .select("person_id")
      .eq("anon_id", anon)
      .eq("event", "page_viewed")
      .single();
    expect(data?.person_id).toBe(merged);
  });
});
