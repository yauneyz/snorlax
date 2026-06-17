-- Initial schema: profiles + subscriptions + RLS + triggers.
-- Webhook is the only writer to `subscriptions`; clients read-only via RLS.

-- profiles: one row per auth.users row. Holds Stripe customer linkage.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- subscriptions: projection of Stripe state, kept in sync by webhook.
create type public.subscription_status as enum (
  'trialing', 'active', 'past_due', 'canceled',
  'incomplete', 'incomplete_expired', 'unpaid', 'paused'
);

create table public.subscriptions (
  id text primary key,                          -- Stripe subscription id (sub_...)
  user_id uuid not null references public.profiles(id) on delete cascade,
  status public.subscription_status not null,
  price_id text not null,                       -- Stripe price id
  quantity int not null default 1,
  cancel_at_period_end boolean not null default false,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  cancel_at timestamptz,
  canceled_at timestamptz,
  trial_start timestamptz,
  trial_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscriptions_user_id_idx on public.subscriptions(user_id);
create index subscriptions_status_idx on public.subscriptions(status);

-- View used by middleware & RSC to answer "is this user entitled?"
create or replace view public.active_subscriptions as
  select *
  from public.subscriptions
  where status in ('trialing', 'active')
    and current_period_end > now();

-- RLS
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;

create policy "profiles: owner read" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles: owner update" on public.profiles
  for update using (auth.uid() = id);
-- No insert policy: profiles are created by trigger, not by client.

create policy "subscriptions: owner read" on public.subscriptions
  for select using (auth.uid() = user_id);
-- No insert/update/delete policies: only service role (webhook) writes.

-- Trigger: auto-create profile when auth.users row is created.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- updated_at maintenance
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();
create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute procedure public.set_updated_at();
