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

export type ConnectionKind = "gsc";

// Bytea columns are returned by PostgREST as `\x...` hex strings or as base64
// depending on the request; we always normalize to `Buffer` at the boundary
// in `src/server/connections/store.ts`. The Row type below describes the shape
// PostgREST returns over the wire.
export type ConnectionRow = {
  id: string;
  user_id: string;
  kind: ConnectionKind;
  label: string | null;
  ciphertext: string;
  iv: string;
  tag: string;
  meta: Record<string, unknown>;
  expires_at: string | null;
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
