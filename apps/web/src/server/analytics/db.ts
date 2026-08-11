import "server-only";
import { cache } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "@/lib/config";
import type { Database } from "@/lib/supabase/database.types";

export type AnalyticsTarget = "prod" | "dev";
export type TargetResult =
  | { ok: true; db: SupabaseClient<Database>; label: string; host: string }
  | { ok: false; reason: "unconfigured" | "unreachable" | "unmigrated"; detail: string };

const clients = new Map<AnalyticsTarget, SupabaseClient<Database>>();

function targetConfig(target: AnalyticsTarget) {
  return config.insights[target];
}

export function analyticsDb(target: AnalyticsTarget): SupabaseClient<Database> | null {
  const existing = clients.get(target);
  if (existing) return existing;
  const { url, secretKey } = targetConfig(target);
  if (!url || !secretKey) return null;

  const db = createClient<Database>(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.timeout(4_000),
        }),
    },
  });
  clients.set(target, db);
  return db;
}

export const resolveTarget = cache(async (target: AnalyticsTarget): Promise<TargetResult> => {
  const db = analyticsDb(target);
  if (!db) {
    return {
      ok: false,
      reason: "unconfigured",
      detail: `${target.toUpperCase()} analytics credentials are not configured. Run pnpm sync:env.`,
    };
  }

  try {
    const { error } = await db.from("analytics_events").select("id", { head: true, count: "exact" });
    if (error) {
      const unmigrated = error.code === "PGRST205" || error.code === "42P01";
      return {
        ok: false,
        reason: unmigrated ? "unmigrated" : "unreachable",
        detail: unmigrated
          ? "Analytics migrations have not been applied to this target."
          : `The analytics database could not be queried: ${error.message}`,
      };
    }
    const url = new URL(targetConfig(target).url);
    return {
      ok: true,
      db,
      label: target === "dev" ? "LOCAL DEV DATABASE" : "PRODUCTION DATABASE",
      host: url.host,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "unreachable",
      detail: `The analytics database is not running or unreachable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
});

export function resetAnalyticsClientsForTests(): void {
  clients.clear();
}
