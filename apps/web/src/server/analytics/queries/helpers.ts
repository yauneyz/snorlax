import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { resolveTarget, type AnalyticsTarget } from "@/server/analytics/db";
import type { PanelData } from "./types";

export async function withAnalyticsTarget<T>(
  target: AnalyticsTarget,
  query: (db: SupabaseClient<Database>) => Promise<T>,
): Promise<PanelData<T>> {
  try {
    const resolved = await resolveTarget(target);
    if (!resolved.ok) return { ok: false, message: resolved.detail };
    return { ok: true, rows: await query(resolved.db) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Analytics query failed.",
    };
  }
}

export function queryError(message: string): Error {
  return new Error(message);
}
