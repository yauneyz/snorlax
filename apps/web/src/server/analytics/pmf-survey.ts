/**
 * PMF survey eligibility (analytics-arch.md-style: point lookups like this stay separate
 * from the aggregate dashboard query-module pattern in `./queries/`, which computes the
 * %-very-disappointed score across all responses, not one person's).
 *
 * Gating: tenure (>=14 days since account creation, so a response reflects real usage rather
 * than day-one enthusiasm) and a re-ask cooldown (>=90 days since the last response, read from
 * the event log itself rather than a fixed once-ever flag, so responses over time become a
 * trend rather than a single point).
 */
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { captureException } from "@/lib/sentry";

const MIN_TENURE_DAYS = 14;
const RE_ASK_COOLDOWN_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function shouldShowPmfSurvey(userId: string, accountCreatedAt: string): Promise<boolean> {
  const tenureDays = (Date.now() - new Date(accountCreatedAt).getTime()) / DAY_MS;
  if (tenureDays < MIN_TENURE_DAYS) return false;

  try {
    const { data, error } = await supabaseAdmin()
      .from("analytics_events")
      .select("occurred_at")
      .eq("user_id", userId)
      .eq("event", "pmf_survey_responded")
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ occurred_at: string }>();
    if (error) throw new Error(`pmf eligibility lookup failed: ${error.message}`);
    if (!data) return true;

    const daysSinceLast = (Date.now() - new Date(data.occurred_at).getTime()) / DAY_MS;
    return daysSinceLast >= RE_ASK_COOLDOWN_DAYS;
  } catch (err) {
    // Never let a survey-eligibility check break the account page.
    await captureException(err, { scope: "analytics.shouldShowPmfSurvey", userId });
    return false;
  }
}
