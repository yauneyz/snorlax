-- Dedup ledger for Stripe webhook events. A row is written after an event is
-- processed successfully; re-deliveries of the same event id are skipped so
-- side effects (notification emails) don't repeat.
create table public.stripe_events (
  id text primary key,                          -- Stripe event id (evt_...)
  type text not null,
  processed_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
-- No policies: only the service role (webhook handler) touches this table.
