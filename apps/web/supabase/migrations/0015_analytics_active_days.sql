-- DAU, measured simply. One row per device per UTC day per kind:
--   protected -- focus was on at some point that day. Sent by the privileged service, the only
--                process up all day (native/common/src/active_ping.rs).
--   ui        -- the desktop app was open at some point that day (apps/desktop/src/main/analytics.ts).
-- Clients send at most one ping per kind per UTC day and the server stamps the date, so a device
-- is counted once per day however often it retries. This replaces analytics_usage_daily as the
-- DAU source: that table depended on a transition-log drain that only ran while the UI was open
-- and dropped days where focus stayed on without toggling.

create table public.analytics_active_days (
  device_id uuid not null,
  utc_date date not null,
  kind text not null check (kind in ('protected', 'ui')),
  reported_at timestamptz not null default now(),
  primary key (device_id, utc_date, kind)
);

create index analytics_active_days_date_idx on public.analytics_active_days(utc_date desc);

-- Resolve devices to people through the same identity graph as usage rows, split into the
-- marketing audience (ignored people excluded) and the dev audience (only ignored people),
-- matching 0010/0011.
create or replace view public.analytics_active_resolved
with (security_invoker = on) as
select a.*, i.person_id
from public.analytics_active_days a
left join public.analytics_identities i on i.identifier = 'device:' || a.device_id::text
where not exists (
  select 1 from public.analytics_ignored_persons g where g.person_id = i.person_id
);

create or replace view public.analytics_dev_active_resolved
with (security_invoker = on) as
select a.*, i.person_id
from public.analytics_active_days a
left join public.analytics_identities i on i.identifier = 'device:' || a.device_id::text
where exists (
  select 1 from public.analytics_ignored_persons g where g.person_id = i.person_id
);

-- People, not devices: a person on two machines counts once. A device never linked to a
-- person (no identity edge yet) counts as its own person. installed_base_30d stays in devices:
-- any device that pinged either kind in the trailing 30 days.
create or replace view public.analytics_active_daily
with (security_invoker = on) as
select
  d.utc_date,
  count(distinct coalesce(d.person_id::text, d.device_id::text))
    filter (where d.kind = 'protected') as dau_protected,
  count(distinct coalesce(d.person_id::text, d.device_id::text))
    filter (where d.kind = 'ui') as dau_ui,
  (
    select count(distinct coalesce(m.person_id::text, m.device_id::text))
    from public.analytics_active_resolved m
    where m.kind = 'protected'
      and m.utc_date > d.utc_date - 30
      and m.utc_date <= d.utc_date
  ) as mau_protected,
  (
    select count(distinct b.device_id)
    from public.analytics_active_resolved b
    where b.utc_date > d.utc_date - 30 and b.utc_date <= d.utc_date
  ) as installed_base_30d
from public.analytics_active_resolved d
group by d.utc_date;

create or replace view public.analytics_dev_active_daily
with (security_invoker = on) as
select
  d.utc_date,
  count(distinct coalesce(d.person_id::text, d.device_id::text))
    filter (where d.kind = 'protected') as dau_protected,
  count(distinct coalesce(d.person_id::text, d.device_id::text))
    filter (where d.kind = 'ui') as dau_ui,
  (
    select count(distinct coalesce(m.person_id::text, m.device_id::text))
    from public.analytics_dev_active_resolved m
    where m.kind = 'protected'
      and m.utc_date > d.utc_date - 30
      and m.utc_date <= d.utc_date
  ) as mau_protected,
  (
    select count(distinct b.device_id)
    from public.analytics_dev_active_resolved b
    where b.utc_date > d.utc_date - 30 and b.utc_date <= d.utc_date
  ) as installed_base_30d
from public.analytics_dev_active_resolved d
group by d.utc_date;

alter table public.analytics_active_days enable row level security;

revoke all on public.analytics_active_days from authenticated, anon;
revoke all on public.analytics_active_resolved from authenticated, anon;
revoke all on public.analytics_dev_active_resolved from authenticated, anon;
revoke all on public.analytics_active_daily from authenticated, anon;
revoke all on public.analytics_dev_active_daily from authenticated, anon;

grant select, insert, update, delete on public.analytics_active_days to service_role;
grant select on public.analytics_active_resolved to service_role;
grant select on public.analytics_dev_active_resolved to service_role;
grant select on public.analytics_active_daily to service_role;
grant select on public.analytics_dev_active_daily to service_role;
