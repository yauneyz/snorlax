/**
 * Hand-maintained Database type for the Supabase admin client. Keeps just
 * enough shape for our tables + view. If the schema grows, regenerate
 * with `supabase gen types typescript --project-id <ref>` and replace this.
 */
import type {
  ActiveEntitlementRow,
  AnalyticsDauRow,
  AnalyticsChannelFunnelRow,
  AnalyticsEngagementDailyRow,
  AnalyticsEventResolvedRow,
  AnalyticsEventRow,
  AnalyticsFunnelRow,
  AnalyticsFunnelSummaryRow,
  AnalyticsIdentityRow,
  AnalyticsInstallHealthRow,
  AnalyticsPersonRow,
  AnalyticsRetentionCohortRow,
  AnalyticsRevenueSummaryRow,
  AnalyticsUsageDailyRow,
  AnalyticsUsageResolvedRow,
  CompCodeRow,
  EntitlementGrantRow,
  ProfileRow,
  StripeEventRow,
  SubscriptionRow,
} from "./types";

/** Matches what `supabase gen types` emits, so a future regeneration is a clean swap. */
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Partial<ProfileRow> & Pick<ProfileRow, "id" | "email">;
        Update: Partial<ProfileRow>;
        Relationships: [];
      };
      subscriptions: {
        Row: SubscriptionRow;
        Insert: Omit<SubscriptionRow, "created_at" | "updated_at"> &
          Partial<Pick<SubscriptionRow, "created_at" | "updated_at">>;
        Update: Partial<SubscriptionRow>;
        Relationships: [];
      };
      entitlement_grants: {
        Row: EntitlementGrantRow;
        Insert: Omit<EntitlementGrantRow, "granted_at" | "plan"> &
          Partial<Pick<EntitlementGrantRow, "granted_at" | "plan">>;
        Update: Partial<EntitlementGrantRow>;
        Relationships: [];
      };
      comp_codes: {
        Row: CompCodeRow;
        Insert: Omit<CompCodeRow, "id" | "created_at" | "redemption_count" | "max_redemptions"> &
          Partial<Pick<CompCodeRow, "id" | "created_at" | "redemption_count" | "max_redemptions">>;
        Update: Partial<CompCodeRow>;
        Relationships: [];
      };
      stripe_events: {
        Row: StripeEventRow;
        Insert: Omit<StripeEventRow, "processed_at"> & Partial<Pick<StripeEventRow, "processed_at">>;
        Update: Partial<StripeEventRow>;
        Relationships: [];
      };
      analytics_persons: {
        Row: AnalyticsPersonRow;
        Insert: Partial<AnalyticsPersonRow>;
        Update: Partial<AnalyticsPersonRow>;
        Relationships: [];
      };
      analytics_identities: {
        Row: AnalyticsIdentityRow;
        Insert: Omit<AnalyticsIdentityRow, "first_seen_at"> &
          Partial<Pick<AnalyticsIdentityRow, "first_seen_at">>;
        Update: Partial<AnalyticsIdentityRow>;
        Relationships: [];
      };
      analytics_events: {
        // `id` is `generated always as identity` and `received_at` defaults to now(), so
        // neither is ever supplied by the writer.
        Row: AnalyticsEventRow;
        Insert: Omit<AnalyticsEventRow, "id" | "received_at" | "props"> &
          Partial<Pick<AnalyticsEventRow, "received_at" | "props">>;
        Update: Partial<Omit<AnalyticsEventRow, "id">>;
        Relationships: [];
      };
      analytics_usage_daily: {
        Row: AnalyticsUsageDailyRow;
        Insert: Pick<
          AnalyticsUsageDailyRow,
          "device_id" | "local_date" | "tz_offset_minutes" | "platform"
        > &
          Partial<AnalyticsUsageDailyRow>;
        Update: Partial<AnalyticsUsageDailyRow>;
        Relationships: [];
      };
    };
    Views: {
      active_subscriptions: {
        Row: SubscriptionRow;
        Relationships: [];
      };
      active_entitlements: {
        Row: ActiveEntitlementRow;
        Relationships: [];
      };
      analytics_events_resolved: {
        Row: AnalyticsEventResolvedRow;
        Relationships: [];
      };
      analytics_usage_resolved: {
        Row: AnalyticsUsageResolvedRow;
        Relationships: [];
      };
      analytics_funnel: {
        Row: AnalyticsFunnelRow;
        Relationships: [];
      };
      analytics_dau: {
        Row: AnalyticsDauRow;
        Relationships: [];
      };
      analytics_channel_funnel: {
        Row: AnalyticsChannelFunnelRow;
        Relationships: [];
      };
      analytics_funnel_summary: {
        Row: AnalyticsFunnelSummaryRow;
        Relationships: [];
      };
      analytics_engagement_daily: {
        Row: AnalyticsEngagementDailyRow;
        Relationships: [];
      };
      analytics_retention_cohorts: {
        Row: AnalyticsRetentionCohortRow;
        Relationships: [];
      };
      analytics_install_health: {
        Row: AnalyticsInstallHealthRow;
        Relationships: [];
      };
      analytics_revenue_summary: {
        Row: AnalyticsRevenueSummaryRow;
        Relationships: [];
      };
    };
    Functions: {
      redeem_comp_code: {
        Args: { p_code_hash: string; p_user_id: string };
        Returns: string;
      };
      /**
       * Returns the person_id every supplied identifier now maps to, merging pre-existing
       * persons where the identifiers bridge them. `p_attribution` fills first-touch
       * columns once and moves last-touch on every call.
       */
      analytics_link: {
        Args: { p_identifiers: string[]; p_attribution?: Json };
        Returns: string;
      };
      /** Takes a JSON array of usage rows; returns the number of rows upserted. */
      analytics_report_usage: {
        Args: { p_rows: Json };
        Returns: number;
      };
    };
    Enums: {
      subscription_status: SubscriptionRow["status"];
    };
    CompositeTypes: Record<string, never>;
  };
};
