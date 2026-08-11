-- Analytics: append-only milestone events + daily usage rollups + a small identity graph.
--
-- Two tiers, deliberately stored differently (see analytics-arch.md §2):
--   tier 1 -> analytics_events        one row per milestone per person  ~30 rows/person/lifetime
--   tier 2 -> analytics_usage_daily   one row per device per day        ~365 rows/device/year
--
-- Events store RAW identifiers (anon/device/user); person resolution happens in the
-- *_resolved views at query time. An identity merge then repoints one row in
-- analytics_identities and every historical row follows -- no backfill, no denormalized
-- person_id to drift.
--
-- RLS posture follows `connections` in 0002: RLS on, no policies, all access through the
-- secret-key client (supabaseAdmin). Client roles are revoked outright.

create table public.analytics_persons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  -- First-touch attribution. Immutable once set: the channel that earned the person.
  first_utm_source text,
  first_utm_medium text,
  first_utm_campaign text,
  first_referrer_host text,
  first_landing_path text,
  first_country text,
  -- Last-touch, for multi-touch sanity checks.
  last_utm_source text,
  last_utm_medium text,
  last_utm_campaign text
);

-- Identifier -> person. Key is prefixed ('anon:<uuid>' | 'device:<uuid>' | 'user:<uuid>')
-- so one text PK covers all three spaces without a composite key.
create table public.analytics_identities (
  identifier text primary key,
  person_id uuid not null references public.analytics_persons(id) on delete cascade,
  first_seen_at timestamptz not null default now()
);

create index analytics_identities_person_idx on public.analytics_identities(person_id);

-- Tier 1: milestones. Grows with people, not with time.
create table public.analytics_events (
  id bigint generated always as identity primary key,
  event text not null,
  -- Client clock, clamped to received_at +/- 24h at ingest (desktop clocks drift and an
  -- offline buffer can flush days late).
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),

  anon_id uuid,
  device_id uuid,
  user_id uuid,

  source text not null,           -- 'web' | 'desktop' | 'server'
  app_version text,
  platform text,                  -- 'win' | 'mac' | 'linux'

  -- Attribution snapshot at event time. Denormalized deliberately: it makes every funnel
  -- query groupable by channel without touching analytics_persons.
  utm_source text,
  utm_medium text,
  utm_campaign text,
  referrer_host text,
  country text,

  props jsonb not null default '{}'::jsonb,

  -- Desktop retries after an offline flush; this makes re-delivery a no-op. Also how
  -- "once per person, ever" is enforced for events that can fire from two call sites
  -- (e.g. account_created from both the signup form and the OAuth callback).
  idempotency_key text unique
);

create index analytics_events_event_time_idx on public.analytics_events(event, occurred_at desc);
create index analytics_events_time_idx       on public.analytics_events(occurred_at desc);
create index analytics_events_anon_idx       on public.analytics_events(anon_id)   where anon_id is not null;
create index analytics_events_device_idx     on public.analytics_events(device_id) where device_id is not null;
create index analytics_events_user_idx       on public.analytics_events(user_id)   where user_id is not null;

-- Tier 2: one row per device per day. Counters are CUMULATIVE FOR THE DAY, never deltas,
-- so the upsert can use greatest() and stay idempotent under retry and reordering.
--
-- Contains counts and durations only. No domains, no app names, no URLs -- nothing
-- describing what a user blocks or visits ever leaves the device.
create table public.analytics_usage_daily (
  device_id uuid not null,
  local_date date not null,
  tz_offset_minutes smallint not null,

  user_id uuid,                   -- last known on this device that day
  platform text not null,
  app_version text,

  app_opens smallint not null default 0,
  focus_enabled_count smallint not null default 0,
  focus_disabled_count smallint not null default 0,
  focus_seconds integer not null default 0,
  longest_focus_seconds integer not null default 0,
  scheduled_focus_seconds integer not null default 0,
  sessions_completed smallint not null default 0,
  sessions_aborted smallint not null default 0,
  key_present_seconds integer not null default 0,
  extension_connected boolean not null default false,

  first_activity_at timestamptz,
  last_activity_at timestamptz,
  reported_at timestamptz not null default now(),

  primary key (device_id, local_date)
);

create index analytics_usage_date_idx on public.analytics_usage_daily(local_date desc);
create index analytics_usage_user_idx on public.analytics_usage_daily(user_id) where user_id is not null;
-- Powers "DAU-protected" without scanning idle rows.
create index analytics_usage_active_idx on public.analytics_usage_daily(local_date desc)
  where focus_seconds >= 60;

-- ---------------------------------------------------------------------------
-- Resolution views: the only things dashboards read.
-- ---------------------------------------------------------------------------

-- `security_invoker = on` matters even though nothing but service_role can read these
-- today: without it a view runs with its OWNER's privileges, so RLS on the base tables
-- would not apply to it. The day someone adds a blanket `grant select on all tables in
-- schema public to authenticated`, that difference is the whole funnel leaking.
create or replace view public.analytics_events_resolved
with (security_invoker = on) as
select
  e.*,
  coalesce(iu.person_id, idv.person_id, ia.person_id) as person_id
from public.analytics_events e
left join public.analytics_identities iu  on iu.identifier  = 'user:'   || e.user_id::text
left join public.analytics_identities idv on idv.identifier = 'device:' || e.device_id::text
left join public.analytics_identities ia  on ia.identifier  = 'anon:'   || e.anon_id::text;

create or replace view public.analytics_usage_resolved
with (security_invoker = on) as
select
  u.*,
  coalesce(iu.person_id, idv.person_id) as person_id
from public.analytics_usage_daily u
left join public.analytics_identities iu  on iu.identifier  = 'user:'   || u.user_id::text
left join public.analytics_identities idv on idv.identifier = 'device:' || u.device_id::text;

-- One row per person with a timestamp per milestone. The dashboard funnel and the
-- channel table are both `select ... from analytics_funnel`.
create or replace view public.analytics_funnel
with (security_invoker = on) as
select
  p.id as person_id,
  p.first_seen_at,
  p.first_utm_source,
  p.first_utm_medium,
  p.first_utm_campaign,
  p.first_referrer_host,
  min(e.occurred_at) filter (where e.event = 'page_viewed')             as visited_at,
  min(e.occurred_at) filter (where e.event = 'download_clicked')        as downloaded_at,
  min(e.occurred_at) filter (where e.event = 'app_installed')           as installed_at,
  min(e.occurred_at) filter (where e.event = 'service_installed')       as service_ready_at,
  min(e.occurred_at) filter (where e.event = 'account_created')         as signed_up_at,
  min(e.occurred_at) filter (where e.event = 'extension_connected')     as extension_at,
  min(e.occurred_at) filter (where e.event = 'usb_key_paired')          as paired_at,
  min(e.occurred_at) filter (where e.event = 'schedule_created')        as scheduled_at,
  -- The `~ '^[0-9]+$'` guard is load-bearing, not defensive noise: `props` arrives from a
  -- public unauthenticated endpoint, and an uncastable session_index on ONE row would make
  -- this whole view raise for every query against it. The regex is evaluated before the
  -- cast in the same AND chain, so a junk row is skipped rather than fatal.
  min(e.occurred_at) filter (where e.event = 'focus_session_completed'
                               and e.props->>'session_index' ~ '^[0-9]+$'
                               and (e.props->>'session_index')::int = 1) as first_session_at,
  min(e.occurred_at) filter (where e.event = 'focus_session_completed'
                               and e.props->>'session_index' ~ '^[0-9]+$'
                               and (e.props->>'session_index')::int = 2) as second_session_at,
  min(e.occurred_at) filter (where e.event = 'trial_started')           as trial_at,
  min(e.occurred_at) filter (where e.event = 'subscription_started')    as paid_at,
  min(e.occurred_at) filter (where e.event = 'subscription_canceled')   as canceled_at
from public.analytics_persons p
left join public.analytics_events_resolved e on e.person_id = p.id
group by p.id;

-- Active users. DAU-protected (focus_seconds >= 60) is the headline: it measures the
-- product doing its job, unlike DAU-UI which falls as users get more habituated.
create or replace view public.analytics_dau
with (security_invoker = on) as
select
  local_date,
  count(*)                                                     as devices_reporting,
  count(*) filter (where focus_seconds >= 60)                  as dau_protected,
  count(*) filter (where app_opens > 0)                        as dau_ui,
  count(distinct person_id) filter (where focus_seconds >= 60) as people_protected,
  round(sum(focus_seconds) / 3600.0, 1)                        as total_focus_hours,
  round(avg(focus_seconds) filter (where focus_seconds >= 60) / 60.0, 1)
                                                               as avg_active_focus_minutes,
  percentile_cont(0.5) within group (order by focus_seconds)
    filter (where focus_seconds >= 60)                         as median_focus_seconds,
  sum(sessions_completed)                                      as sessions_completed,
  sum(sessions_aborted)                                        as sessions_aborted
from public.analytics_usage_resolved
group by local_date;

-- ---------------------------------------------------------------------------
-- Identity resolution
-- ---------------------------------------------------------------------------

-- Links a set of identifiers to a single person, merging pre-existing persons when the
-- identifiers arrive already belonging to different ones (e.g. a device seen anonymously
-- now signs in as a known web visitor). Oldest person wins; losers are repointed and
-- deleted. Events and usage rows are untouched -- they resolve through the views.
-- `p_attribution` carries the request's channel context: utm_source/utm_medium/
-- utm_campaign/referrer_host/landing_path/country. First-touch columns are filled only
-- while still null (the channel that earned the person is immutable); last-touch always
-- moves. Folded into this function rather than a second statement because it runs on the
-- public ingest hot path and one round trip beats two.
create or replace function public.analytics_link(
  p_identifiers text[],
  p_attribution jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person uuid;
  v_person_user uuid;
  v_found uuid[];
  v_losers uuid[];
begin
  -- Serialize the whole function. The ingest endpoints are public and unauthenticated, so
  -- concurrent calls are certain, and merging is a multi-statement read-modify-write over a
  -- graph. Because analytics_identities cascades on person delete, two interleaved merges
  -- with overlapping identifier sets can each pick a different winner and delete the
  -- other's -- silently taking the identity edges the other just repointed with it. That
  -- corruption is invisible until a funnel number looks wrong months later.
  --
  -- The cost is negligible: this runs ~30 times per person per lifetime (tier 2 usage rows
  -- do not call it), so there is no throughput to protect.
  perform pg_advisory_xact_lock(hashtext('analytics_link'));

  select array_agg(distinct person_id) into v_found
  from public.analytics_identities
  where identifier = any(p_identifiers);

  if v_found is null or array_length(v_found, 1) = 0 then
    insert into public.analytics_persons default values returning id into v_person;
  else
    select id, user_id into v_person, v_person_user
    from public.analytics_persons
    where id = any(v_found)
    order by first_seen_at asc, id asc
    limit 1;

    -- Only fold in persons that are not already a DIFFERENT known account. Two persons
    -- carrying distinct non-null user_ids are two humans -- most likely two people sharing
    -- a browser or a machine -- and welding them together would be unrecoverable, since the
    -- events keep no person_id to un-merge. Leave those rows and their edges alone; the
    -- identifier insert below is `do nothing`, so their existing mappings survive.
    -- (user_id is unique, so a mergeable loser always has user_id is null and the promotion
    -- at the end of this function cannot collide.)
    select array_agg(id) into v_losers
    from public.analytics_persons
    where id = any(v_found)
      and id <> v_person
      and (user_id is null or user_id is not distinct from v_person_user);

    if v_losers is not null and array_length(v_losers, 1) > 0 then
      update public.analytics_identities
        set person_id = v_person
        where person_id = any(v_losers);
      -- Carry the earliest first-touch forward, then drop the merged-away rows.
      update public.analytics_persons w set
        first_seen_at       = least(w.first_seen_at, l.first_seen_at),
        first_utm_source    = coalesce(w.first_utm_source,    l.first_utm_source),
        first_utm_medium    = coalesce(w.first_utm_medium,    l.first_utm_medium),
        first_utm_campaign  = coalesce(w.first_utm_campaign,  l.first_utm_campaign),
        first_referrer_host = coalesce(w.first_referrer_host, l.first_referrer_host),
        first_landing_path  = coalesce(w.first_landing_path,  l.first_landing_path),
        first_country       = coalesce(w.first_country,       l.first_country)
      from (
        select * from public.analytics_persons
        where id = any(v_losers)
        order by first_seen_at asc limit 1
      ) l
      where w.id = v_person;

      delete from public.analytics_persons where id = any(v_losers);
    end if;
  end if;

  insert into public.analytics_identities (identifier, person_id)
  select unnest(p_identifiers), v_person
  on conflict (identifier) do nothing;

  -- Promote user_id onto the person when we learn it.
  update public.analytics_persons p
     set user_id = substring(i.identifier from 6)::uuid
    from unnest(p_identifiers) i(identifier)
   where p.id = v_person
     and i.identifier like 'user:%'
     and p.user_id is null;

  update public.analytics_persons p set
    last_seen_at        = now(),
    -- First-touch: write once, never overwrite. `nullif(..., '')` so an empty string from
    -- a query param does not count as having earned the person.
    first_utm_source    = coalesce(p.first_utm_source,    nullif(p_attribution->>'utm_source', '')),
    first_utm_medium    = coalesce(p.first_utm_medium,    nullif(p_attribution->>'utm_medium', '')),
    first_utm_campaign  = coalesce(p.first_utm_campaign,  nullif(p_attribution->>'utm_campaign', '')),
    first_referrer_host = coalesce(p.first_referrer_host, nullif(p_attribution->>'referrer_host', '')),
    first_landing_path  = coalesce(p.first_landing_path,  nullif(p_attribution->>'landing_path', '')),
    first_country       = coalesce(p.first_country,       nullif(p_attribution->>'country', '')),
    -- Last-touch: moves whenever we learn something, but a visit with no UTM must not
    -- erase the last campaign we did see.
    last_utm_source     = coalesce(nullif(p_attribution->>'utm_source', ''),   p.last_utm_source),
    last_utm_medium     = coalesce(nullif(p_attribution->>'utm_medium', ''),   p.last_utm_medium),
    last_utm_campaign   = coalesce(nullif(p_attribution->>'utm_campaign', ''), p.last_utm_campaign)
  where p.id = v_person;

  return v_person;
end;
$$;

-- ---------------------------------------------------------------------------
-- The usage upsert
-- ---------------------------------------------------------------------------

-- Idempotent under retry and reordering: counters only ever move up within a day, so a
-- replayed batch is a no-op and a stale flush arriving after a fresh one cannot regress
-- the row. A whole backfill -- a week of catch-up rows -- is one call with a JSON array.
--
-- Columns are listed explicitly rather than `select *`: jsonb_populate_recordset yields
-- NULL for absent keys, and an explicit NULL in an INSERT bypasses the column default,
-- which would violate the not-null constraints on the counters and reported_at.
create or replace function public.analytics_report_usage(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with parsed as (
    select * from jsonb_populate_recordset(null::public.analytics_usage_daily, p_rows)
  ),
  -- ON CONFLICT DO UPDATE cannot touch the same row twice in one statement, so collapse
  -- duplicate (device_id, local_date) pairs within a single batch first. Counters are
  -- cumulative, so the row with the most focus time is the freshest view of that day.
  incoming as (
    select distinct on (device_id, local_date) *
    from parsed
    where device_id is not null and local_date is not null
    order by device_id, local_date, focus_seconds desc nulls last
  )
  insert into public.analytics_usage_daily as t (
    device_id, local_date, tz_offset_minutes, user_id, platform, app_version,
    app_opens, focus_enabled_count, focus_disabled_count, focus_seconds,
    longest_focus_seconds, scheduled_focus_seconds, sessions_completed,
    sessions_aborted, key_present_seconds, extension_connected,
    first_activity_at, last_activity_at, reported_at
  )
  select
    i.device_id,
    i.local_date,
    coalesce(i.tz_offset_minutes, 0),
    i.user_id,
    coalesce(i.platform, 'unknown'),
    i.app_version,
    coalesce(i.app_opens, 0),
    coalesce(i.focus_enabled_count, 0),
    coalesce(i.focus_disabled_count, 0),
    coalesce(i.focus_seconds, 0),
    coalesce(i.longest_focus_seconds, 0),
    coalesce(i.scheduled_focus_seconds, 0),
    coalesce(i.sessions_completed, 0),
    coalesce(i.sessions_aborted, 0),
    coalesce(i.key_present_seconds, 0),
    coalesce(i.extension_connected, false),
    i.first_activity_at,
    i.last_activity_at,
    now()
  from incoming i
  on conflict (device_id, local_date) do update set
    user_id                 = coalesce(excluded.user_id, t.user_id),
    platform                = excluded.platform,
    app_version             = excluded.app_version,
    tz_offset_minutes       = excluded.tz_offset_minutes,
    app_opens               = greatest(t.app_opens,               excluded.app_opens),
    focus_enabled_count     = greatest(t.focus_enabled_count,     excluded.focus_enabled_count),
    focus_disabled_count    = greatest(t.focus_disabled_count,    excluded.focus_disabled_count),
    focus_seconds           = greatest(t.focus_seconds,           excluded.focus_seconds),
    longest_focus_seconds   = greatest(t.longest_focus_seconds,   excluded.longest_focus_seconds),
    scheduled_focus_seconds = greatest(t.scheduled_focus_seconds, excluded.scheduled_focus_seconds),
    sessions_completed      = greatest(t.sessions_completed,      excluded.sessions_completed),
    sessions_aborted        = greatest(t.sessions_aborted,        excluded.sessions_aborted),
    key_present_seconds     = greatest(t.key_present_seconds,     excluded.key_present_seconds),
    extension_connected     = t.extension_connected or excluded.extension_connected,
    first_activity_at       = least(t.first_activity_at, excluded.first_activity_at),
    last_activity_at        = greatest(t.last_activity_at, excluded.last_activity_at),
    reported_at             = now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------

alter table public.analytics_persons     enable row level security;
alter table public.analytics_identities  enable row level security;
alter table public.analytics_events      enable row level security;
alter table public.analytics_usage_daily enable row level security;

-- No policies, and client roles revoked outright: these tables are never reachable from
-- a browser. Ingest and dashboards both go through the secret-key client.
revoke all on public.analytics_persons     from authenticated, anon;
revoke all on public.analytics_identities  from authenticated, anon;
revoke all on public.analytics_events      from authenticated, anon;
revoke all on public.analytics_usage_daily from authenticated, anon;
revoke all on public.analytics_events_resolved from authenticated, anon;
revoke all on public.analytics_usage_resolved  from authenticated, anon;
revoke all on public.analytics_funnel          from authenticated, anon;
revoke all on public.analytics_dau             from authenticated, anon;

-- Recent Supabase projects no longer grant DML on new public tables to service_role by
-- default, so these must be explicit or every supabaseAdmin() query fails with
-- "permission denied for table ..." before RLS is ever consulted. Same reasoning as 0005.
grant select, insert, update, delete on public.analytics_persons     to service_role;
grant select, insert, update, delete on public.analytics_identities  to service_role;
grant select, insert, update, delete on public.analytics_events      to service_role;
grant select, insert, update, delete on public.analytics_usage_daily to service_role;
grant select on public.analytics_events_resolved to service_role;
grant select on public.analytics_usage_resolved  to service_role;
grant select on public.analytics_funnel          to service_role;
grant select on public.analytics_dau             to service_role;

revoke all on function public.analytics_link(text[], jsonb)           from public, anon, authenticated;
revoke all on function public.analytics_report_usage(jsonb)    from public, anon, authenticated;
grant execute on function public.analytics_link(text[], jsonb)        to service_role;
grant execute on function public.analytics_report_usage(jsonb) to service_role;
