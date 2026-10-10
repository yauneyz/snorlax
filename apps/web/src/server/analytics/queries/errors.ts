import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { config } from "@/lib/config";
import { USER_FACING_ERROR_EVENTS } from "@/lib/analytics/events";
import { audienceView, type AnalyticsAudience } from "@/server/analytics/audience";
import type { AnalyticsTarget } from "@/server/analytics/db";
import { queryError, withAnalyticsTarget } from "./helpers";
import type { PanelData } from "./types";

export interface ErrorReport {
  event: string;
  platform: string | null;
  appVersion: string | null;
  deviceId: string | null;
  occurredAt: string;
  receivedAt: string;
  message: string;
  stack: string | null;
  /** The signed-in account behind the device, when the identity graph links one. */
  account: { email: string; name: string | null } | null;
}

const MAX_ERRORS = 200;

type ErrorAccount = NonNullable<ErrorReport["account"]>;

function toReport(
  row: {
    event: string;
    platform: string | null;
    app_version: string | null;
    device_id: string | null;
    occurred_at: string;
    received_at: string;
    props: Record<string, unknown> | null;
    person_id: string | null;
  },
  accounts: Map<string, ErrorAccount>,
): ErrorReport {
  const props = row.props ?? {};
  return {
    event: row.event,
    platform: row.platform,
    appVersion: row.app_version,
    deviceId: row.device_id,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    message: typeof props.message === "string" ? props.message : row.event,
    stack: typeof props.stack === "string" ? props.stack : null,
    account: (row.person_id && accounts.get(row.person_id)) || null,
  };
}

/**
 * person_id -> account, for the people among these errors who have ever signed in. Two batched
 * lookups (persons, then profiles) rather than a view: this is the only panel that needs PII,
 * and keeping it here keeps emails out of every other analytics read.
 */
async function loadAccounts(
  db: SupabaseClient<Database>,
  personIds: string[],
): Promise<Map<string, ErrorAccount>> {
  const accounts = new Map<string, ErrorAccount>();
  if (personIds.length === 0) return accounts;

  const { data: persons, error: personsError } = await db
    .from("analytics_persons")
    .select("id, user_id")
    .in("id", personIds)
    .not("user_id", "is", null);
  if (personsError) throw queryError(personsError.message);
  const userIds = [...new Set((persons ?? []).map((p) => p.user_id!))];
  if (userIds.length === 0) return accounts;

  const { data: profiles, error: profilesError } = await db
    .from("profiles")
    .select("id, email, full_name")
    .in("id", userIds);
  if (profilesError) throw queryError(profilesError.message);
  const byUser = new Map((profiles ?? []).map((p) => [p.id, { email: p.email, name: p.full_name }]));

  for (const person of persons ?? []) {
    const account = byUser.get(person.user_id!);
    if (account) accounts.set(person.id, account);
  }
  return accounts;
}

/** Always queries Supabase directly. What GET /api/analytics/errors itself calls. */
export const queryRecentErrorsFromDb = cache(
  async (target: AnalyticsTarget, audience: AnalyticsAudience = "prod") =>
    withAnalyticsTarget<ErrorReport[]>(target, async (db) => {
      const { data, error } = await db
        .from(audienceView(audience, "analytics_events_resolved", "analytics_dev_events_resolved"))
        .select("event, platform, app_version, device_id, occurred_at, received_at, props, person_id")
        .in("event", [...USER_FACING_ERROR_EVENTS])
        .order("received_at", { ascending: false })
        .limit(MAX_ERRORS);
      if (error) throw queryError(error.message);
      const rows = data ?? [];
      const personIds = [...new Set(rows.flatMap((row) => (row.person_id ? [row.person_id] : [])))];
      const accounts = await loadAccounts(db, personIds);
      return rows.map((row) => toReport(row, accounts));
    }),
);

/**
 * Prod reads through the same deployed, bearer-token-gated route the Android errors screen
 * uses (mirrors summary-client.ts's fetchProdSummary) instead of holding a second Supabase
 * client for it; the internal audience reads its production DB view directly.
 */
const fetchProdErrors = cache(async (): Promise<PanelData<ErrorReport[]>> => {
  if (!config.insights.widgetApiKey) {
    return {
      ok: false,
      message: "INSIGHTS_WIDGET_API_KEY is not configured locally. Run pnpm sync:env.",
    };
  }
  try {
    const res = await fetch(`${config.insights.apiBaseUrl}/api/analytics/errors`, {
      headers: { Authorization: `Bearer ${config.insights.widgetApiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return { ok: false, message: `Errors API responded ${res.status}` };
    return { ok: true, rows: (await res.json()) as ErrorReport[] };
  } catch (error) {
    return {
      ok: false,
      message: `Errors API is unreachable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
});

/** Marketing errors use the deployed API; internal errors use the ignored-person view directly. */
export const queryRecentErrors = cache(
  async (
    target: AnalyticsTarget,
    audience: AnalyticsAudience = "prod",
  ): Promise<PanelData<ErrorReport[]>> => {
    if (target === "prod" && audience === "prod") return fetchProdErrors();
    return queryRecentErrorsFromDb(target, audience);
  },
);
