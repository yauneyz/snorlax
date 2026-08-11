export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | "paused";

export type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  stripe_customer_id: string | null;
  created_at: string;
  updated_at: string;
};

export type StripeEventRow = {
  id: string;
  type: string;
  processed_at: string;
};

/** Complimentary Pro grant — issued by the `pnpm comp:*` scripts or a redeemed code. */
export type EntitlementGrantRow = {
  user_id: string;
  plan: string;
  note: string | null;
  source: "manual" | "code";
  code_id: string | null;
  granted_at: string;
  expires_at: string | null;
  revoked_at: string | null;
};

/** Redemption code for a complimentary grant. Server-only: the row holds a secret's hash. */
export type CompCodeRow = {
  id: string;
  code_hash: string;
  note: string | null;
  max_redemptions: number;
  redemption_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

/** Union of live subscriptions and active grants — the single "is this user entitled?" read. */
export type ActiveEntitlementRow = {
  user_id: string;
  source: "subscription" | "grant";
  status: string;
  current_period_end: string | null;
};

export type SubscriptionRow = {
  id: string;
  user_id: string;
  status: SubscriptionStatus;
  price_id: string;
  quantity: number;
  cancel_at_period_end: boolean;
  current_period_start: string;
  current_period_end: string;
  cancel_at: string | null;
  canceled_at: string | null;
  trial_start: string | null;
  trial_end: string | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Analytics (see analytics-arch.md, migration 0006)
// ---------------------------------------------------------------------------

/**
 * A human, as far as we can tell. First-touch attribution is immutable once set — it is
 * the channel that earned the person — while last-touch moves.
 */
export type AnalyticsPersonRow = {
  id: string;
  user_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  first_utm_source: string | null;
  first_utm_medium: string | null;
  first_utm_campaign: string | null;
  first_referrer_host: string | null;
  first_landing_path: string | null;
  first_country: string | null;
  last_utm_source: string | null;
  last_utm_medium: string | null;
  last_utm_campaign: string | null;
};

/** `identifier` is prefixed: 'anon:<uuid>' | 'device:<uuid>' | 'user:<uuid>'. */
export type AnalyticsIdentityRow = {
  identifier: string;
  person_id: string;
  first_seen_at: string;
};

/**
 * Tier 1: one row per milestone per person, ~30 per person for a lifetime. Stores RAW
 * identifiers — person resolution happens in `analytics_events_resolved` at query time,
 * so an identity merge needs no backfill.
 */
export type AnalyticsEventRow = {
  id: number;
  event: string;
  occurred_at: string;
  received_at: string;
  anon_id: string | null;
  device_id: string | null;
  user_id: string | null;
  source: "web" | "desktop" | "server";
  app_version: string | null;
  platform: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  referrer_host: string | null;
  country: string | null;
  props: Record<string, unknown>;
  idempotency_key: string | null;
};

/**
 * Tier 2: one row per device per day. Counters are CUMULATIVE for the day, never deltas,
 * which is what lets the upsert use `greatest()` and stay idempotent under retry and
 * reordering. Counts and durations only — nothing describing what was blocked.
 */
export type AnalyticsUsageDailyRow = {
  device_id: string;
  local_date: string;
  tz_offset_minutes: number;
  user_id: string | null;
  platform: string;
  app_version: string | null;
  app_opens: number;
  focus_enabled_count: number;
  focus_disabled_count: number;
  focus_seconds: number;
  longest_focus_seconds: number;
  scheduled_focus_seconds: number;
  sessions_completed: number;
  sessions_aborted: number;
  key_present_seconds: number;
  extension_connected: boolean;
  first_activity_at: string | null;
  last_activity_at: string | null;
  reported_at: string;
};

/** `analytics_events_resolved` / `analytics_usage_resolved`: base row + resolved person. */
export type AnalyticsEventResolvedRow = AnalyticsEventRow & { person_id: string | null };
export type AnalyticsUsageResolvedRow = AnalyticsUsageDailyRow & { person_id: string | null };

/** One row per person, one timestamp column per funnel milestone. */
export type AnalyticsFunnelRow = {
  person_id: string;
  first_seen_at: string;
  first_utm_source: string | null;
  first_utm_medium: string | null;
  first_utm_campaign: string | null;
  first_referrer_host: string | null;
  visited_at: string | null;
  downloaded_at: string | null;
  installed_at: string | null;
  service_ready_at: string | null;
  signed_up_at: string | null;
  extension_at: string | null;
  paired_at: string | null;
  scheduled_at: string | null;
  first_session_at: string | null;
  second_session_at: string | null;
  trial_at: string | null;
  paid_at: string | null;
  canceled_at: string | null;
};

/** Daily active users. `dau_protected` (focus_seconds >= 60) is the headline metric. */
export type AnalyticsDauRow = {
  local_date: string;
  devices_reporting: number;
  dau_protected: number;
  dau_ui: number;
  people_protected: number;
  total_focus_hours: number | null;
  avg_active_focus_minutes: number | null;
  median_focus_seconds: number | null;
  sessions_completed: number | null;
  sessions_aborted: number | null;
};

export type AnalyticsChannelFunnelRow = {
  channel: string;
  medium: string;
  visitors: number;
  downloaded: number;
  installed: number;
  accounts: number;
  paired: number;
  activated: number;
  habit_forming: number;
  trials: number;
  paid: number;
  pct_visitor_to_paid: number | null;
};

export type AnalyticsFunnelSummaryRow = Omit<
  AnalyticsChannelFunnelRow,
  "channel" | "medium" | "pct_visitor_to_paid"
> & {
  median_visit_to_download_seconds: number | null;
  median_install_to_value_seconds: number | null;
};

export type AnalyticsEngagementDailyRow = AnalyticsDauRow & {
  median_focus_minutes: number | null;
  scheduled_focus_hours: number | null;
  manual_focus_hours: number | null;
  mau_protected: number;
  installed_base_30d: number;
};

export type AnalyticsRetentionCohortRow = {
  cohort_week: string;
  devices: number;
  eligible_d1: number;
  eligible_d7: number;
  eligible_d30: number;
  d1_protected: number;
  d7_protected: number;
  d30_protected: number;
};

export type AnalyticsInstallHealthRow = {
  platform: string;
  failure_reason: string | null;
  app_installed: number;
  service_installed: number;
  extension_connected: number;
  install_failed: number;
};

export type AnalyticsRevenueSummaryRow = {
  active_subscriptions: number;
  active_trials: number;
  trials_started: number;
  subscriptions_started: number;
  cancel_intents: number;
  subscriptions_ended: number;
  payments_failed: number;
  refunds: number;
  tracked_revenue: number;
};
