-- 0013 used the one-row-per-user comp table for purchases. No production or
-- development rows had been written there when this correction was prepared.
-- Keep a separate row per Checkout Session so refunds and retries are precise.
alter table public.entitlement_grants drop constraint entitlement_grants_source_check;
alter table public.entitlement_grants add constraint entitlement_grants_source_check
  check (source in ('manual', 'code'));

create table public.lifetime_purchases (
  checkout_session_id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  payment_intent_id text unique, -- null for a fully discounted Checkout Session
  purchased_at timestamptz not null default now(),
  refunded_at timestamptz
);

create index lifetime_purchases_active_user_idx on public.lifetime_purchases(user_id)
  where refunded_at is null;

alter table public.lifetime_purchases enable row level security;
create policy "lifetime_purchases: owner read" on public.lifetime_purchases
  for select using (auth.uid() = user_id);
grant select on public.lifetime_purchases to authenticated;
grant select, insert, update, delete on public.lifetime_purchases to service_role;

-- All access checks already read this view. Preserve the subscription and comp
-- branches, adding a distinct lifetime status for account and desktop display.
create or replace view public.active_entitlements
with (security_invoker = true) as
  select user_id, 'subscription'::text as source, status::text as status, current_period_end
  from public.subscriptions
  where status in ('trialing', 'active') and current_period_end > now()
  union all
  select user_id, 'grant'::text as source, 'comped'::text as status,
    expires_at as current_period_end
  from public.entitlement_grants
  where revoked_at is null and (expires_at is null or expires_at > now())
  union all
  select user_id, 'lifetime_purchase'::text as source, 'lifetime'::text as status,
    null::timestamptz as current_period_end
  from public.lifetime_purchases
  where refunded_at is null;
