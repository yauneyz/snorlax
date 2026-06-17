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
// in `src/lib/connections/store.ts`. The Row type below describes the shape
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
