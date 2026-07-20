/**
 * Hand-maintained Database type for the Supabase admin client. Keeps just
 * enough shape for our tables + view. If the schema grows, regenerate
 * with `supabase gen types typescript --project-id <ref>` and replace this.
 */
import type {
  ActiveEntitlementRow,
  CompCodeRow,
  ConnectionRow,
  EntitlementGrantRow,
  ProfileRow,
  StripeEventRow,
  SubscriptionRow,
} from "./types";

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
      connections: {
        Row: ConnectionRow;
        Insert: Omit<ConnectionRow, "id" | "created_at" | "updated_at"> &
          Partial<Pick<ConnectionRow, "id" | "created_at" | "updated_at">>;
        Update: Partial<ConnectionRow>;
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
    };
    Functions: {
      redeem_comp_code: {
        Args: { p_code_hash: string; p_user_id: string };
        Returns: string;
      };
    };
    Enums: {
      subscription_status: SubscriptionRow["status"];
      connection_kind: ConnectionRow["kind"];
    };
    CompositeTypes: Record<string, never>;
  };
};
