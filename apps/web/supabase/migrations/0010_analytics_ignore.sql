-- Internal/dogfooding traffic pollutes visitor and usage stats. Reversible ignore list, same
-- posture as the bot classification in 0007: raw rows in analytics_events / analytics_usage_daily
-- are never touched, filtering happens at read time in the resolved views, so un-ignoring
-- someone needs no backfill.
--
-- Two tables because the join key everything actually resolves through is person_id, but the
-- durable thing worth remembering is "this account is me":
--   analytics_ignored_users   -- account allowlist, keyed by user_id (stable, set by hand)
--   analytics_ignored_persons -- the actual filter set, keyed by person_id (what the views use)
-- A trigger keeps the second in sync with the first: the moment a person on the allowlist signs
-- in during a tracked session and analytics_link() promotes user_id onto analytics_persons, that
-- person is auto-ignored with no manual step. Anonymous test traffic (no user_id yet, or never
-- will be) is ignored directly by person_id.

create table public.analytics_ignored_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null default 'internal',
  created_at timestamptz not null default now()
);

create table public.analytics_ignored_persons (
  person_id uuid primary key references public.analytics_persons(id) on delete cascade,
  reason text not null default 'internal',
  ignored_at timestamptz not null default now()
);

create or replace function public.analytics_sync_ignored_person()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null and exists (
    select 1 from public.analytics_ignored_users where user_id = new.user_id
  ) then
    insert into public.analytics_ignored_persons (person_id, reason)
    values (new.id, 'internal account (auto-linked)')
    on conflict (person_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger analytics_sync_ignored_person
  after insert or update of user_id on public.analytics_persons
  for each row
  execute function public.analytics_sync_ignored_person();

-- Re-resolve with ignored persons dropped: every downstream view (funnel, dau, engagement,
-- retention, install health) reads through these two, so filtering here is the one choke point
-- for anything keyed off an event or a usage row.
create or replace view public.analytics_events_resolved
with (security_invoker = on) as
select
  e.*,
  coalesce(iu.person_id, idv.person_id, ia.person_id) as person_id
from public.analytics_events e
left join public.analytics_identities iu  on iu.identifier  = 'user:'   || e.user_id::text
left join public.analytics_identities idv on idv.identifier = 'device:' || e.device_id::text
left join public.analytics_identities ia  on ia.identifier  = 'anon:'   || e.anon_id::text
where not exists (
  select 1 from public.analytics_ignored_persons g
  where g.person_id = coalesce(iu.person_id, idv.person_id, ia.person_id)
);

create or replace view public.analytics_usage_resolved
with (security_invoker = on) as
select
  u.*,
  coalesce(iu.person_id, idv.person_id) as person_id
from public.analytics_usage_daily u
left join public.analytics_identities iu  on iu.identifier  = 'user:'   || u.user_id::text
left join public.analytics_identities idv on idv.identifier = 'device:' || u.device_id::text
where not exists (
  select 1 from public.analytics_ignored_persons g
  where g.person_id = coalesce(iu.person_id, idv.person_id)
);

-- The funnel's base is analytics_persons directly (a person with zero events still counts as a
-- "visitor" row), so it needs its own filter -- excluding ignored persons from events_resolved
-- alone would leave their empty funnel row counted.
create or replace view public.analytics_funnel
with (security_invoker = on) as
select
  p.id as person_id,
  p.first_seen_at,
  p.first_utm_source,
  p.first_utm_medium,
  p.first_utm_campaign,
  p.first_referrer_host,
  min(e.occurred_at) filter (where e.event = 'page_viewed') as visited_at,
  min(e.occurred_at) filter (where e.event = 'download_clicked') as downloaded_at,
  min(e.occurred_at) filter (where e.event = 'app_installed') as installed_at,
  min(e.occurred_at) filter (where e.event = 'service_installed') as service_ready_at,
  min(e.occurred_at) filter (where e.event = 'account_created') as signed_up_at,
  min(e.occurred_at) filter (where e.event = 'extension_connected') as extension_at,
  min(e.occurred_at) filter (where e.event = 'usb_key_paired') as paired_at,
  min(e.occurred_at) filter (where e.event = 'schedule_created') as scheduled_at,
  min(e.occurred_at) filter (
    where e.event = 'focus_session_completed'
      and e.props->>'session_index' ~ '^[0-9]+$'
      and (e.props->>'session_index')::int = 1
  ) as first_session_at,
  min(e.occurred_at) filter (
    where e.event = 'focus_session_completed'
      and e.props->>'session_index' ~ '^[0-9]+$'
      and (e.props->>'session_index')::int = 2
  ) as second_session_at,
  min(e.occurred_at) filter (where e.event = 'trial_started') as trial_at,
  min(e.occurred_at) filter (where e.event = 'subscription_started') as paid_at,
  min(e.occurred_at) filter (where e.event = 'subscription_canceled') as canceled_at
from public.analytics_persons p
left join public.analytics_events_resolved e
  on e.person_id = p.id
 and not (e.event = 'page_viewed' and coalesce(e.props->>'ua_class', '') = 'bot')
where not exists (
  select 1 from public.analytics_ignored_persons g where g.person_id = p.id
)
group by p.id;

-- Revenue counts pulled from the raw table, not the resolved view -- switch to the resolved
-- view so ignored persons drop out of trial/subscription counts the same as everywhere else.
create or replace view public.analytics_revenue_summary
with (security_invoker = on) as
select
  (select count(*) from public.subscriptions where status = 'active' and current_period_end > now()) as active_subscriptions,
  (select count(*) from public.subscriptions where status = 'trialing' and current_period_end > now()) as active_trials,
  count(*) filter (where event = 'trial_started') as trials_started,
  count(*) filter (where event = 'subscription_started') as subscriptions_started,
  count(*) filter (where event = 'subscription_canceled') as cancel_intents,
  count(*) filter (where event = 'subscription_ended') as subscriptions_ended,
  count(*) filter (where event = 'payment_failed') as payments_failed,
  count(*) filter (where event = 'refund_issued') as refunds,
  coalesce(sum((props->>'amount')::numeric) filter (
    where event in ('subscription_started', 'subscription_renewed')
      and props->>'amount' ~ '^[0-9]+(?:\.[0-9]+)?$'
  ), 0) as tracked_revenue
from public.analytics_events_resolved;

-- ---------------------------------------------------------------------------
-- Access control -- same posture as 0006/0007: no client roles, service_role only.
-- ---------------------------------------------------------------------------

alter table public.analytics_ignored_users   enable row level security;
alter table public.analytics_ignored_persons enable row level security;

revoke all on public.analytics_ignored_users   from authenticated, anon;
revoke all on public.analytics_ignored_persons from authenticated, anon;

grant select, insert, update, delete on public.analytics_ignored_users   to service_role;
grant select, insert, update, delete on public.analytics_ignored_persons to service_role;

revoke all on function public.analytics_sync_ignored_person() from public, anon, authenticated;
