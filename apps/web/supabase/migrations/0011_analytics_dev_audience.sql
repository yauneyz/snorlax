-- Give internal/dogfooding people their own complete dashboard over the production pipeline.
-- Raw rows remain in the same tables. The existing analytics_* views are the marketing audience
-- (ignored people excluded); the analytics_dev_* views are the exact complement (only ignored
-- people). Keeping the split at the resolved-view choke point makes every downstream panel agree.

create or replace view public.analytics_dev_events_resolved
with (security_invoker = on) as
select
  e.*,
  coalesce(iu.person_id, idv.person_id, ia.person_id) as person_id
from public.analytics_events e
left join public.analytics_identities iu  on iu.identifier  = 'user:'   || e.user_id::text
left join public.analytics_identities idv on idv.identifier = 'device:' || e.device_id::text
left join public.analytics_identities ia  on ia.identifier  = 'anon:'   || e.anon_id::text
where exists (
  select 1 from public.analytics_ignored_persons g
  where g.person_id = coalesce(iu.person_id, idv.person_id, ia.person_id)
);

create or replace view public.analytics_dev_usage_resolved
with (security_invoker = on) as
select
  u.*,
  coalesce(iu.person_id, idv.person_id) as person_id
from public.analytics_usage_daily u
left join public.analytics_identities iu  on iu.identifier  = 'user:'   || u.user_id::text
left join public.analytics_identities idv on idv.identifier = 'device:' || u.device_id::text
where exists (
  select 1 from public.analytics_ignored_persons g
  where g.person_id = coalesce(iu.person_id, idv.person_id)
);

create or replace view public.analytics_dev_funnel
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
join public.analytics_ignored_persons g on g.person_id = p.id
left join public.analytics_dev_events_resolved e
  on e.person_id = p.id
 and not (e.event = 'page_viewed' and coalesce(e.props->>'ua_class', '') = 'bot')
group by p.id;

create or replace view public.analytics_dev_dau
with (security_invoker = on) as
select
  local_date,
  count(*) as devices_reporting,
  count(*) filter (where focus_seconds >= 60) as dau_protected,
  count(*) filter (where app_opens > 0) as dau_ui,
  count(distinct person_id) filter (where focus_seconds >= 60) as people_protected,
  round(sum(focus_seconds) / 3600.0, 1) as total_focus_hours,
  round(avg(focus_seconds) filter (where focus_seconds >= 60) / 60.0, 1) as avg_active_focus_minutes,
  percentile_cont(0.5) within group (order by focus_seconds)
    filter (where focus_seconds >= 60) as median_focus_seconds,
  sum(sessions_completed) as sessions_completed,
  sum(sessions_aborted) as sessions_aborted
from public.analytics_dev_usage_resolved
group by local_date;

create or replace view public.analytics_dev_channel_funnel
with (security_invoker = on) as
select
  coalesce(first_utm_source, first_referrer_host, 'direct') as channel,
  coalesce(first_utm_medium, 'none') as medium,
  count(*) as visitors,
  count(downloaded_at) as downloaded,
  count(installed_at) as installed,
  count(signed_up_at) as accounts,
  count(paired_at) as paired,
  count(first_session_at) as activated,
  count(second_session_at) as habit_forming,
  count(trial_at) as trials,
  count(paid_at) as paid,
  round(100.0 * count(paid_at) / nullif(count(*), 0), 2) as pct_visitor_to_paid
from public.analytics_dev_funnel
where first_seen_at >= now() - interval '90 days'
group by 1, 2;

create or replace view public.analytics_dev_funnel_summary
with (security_invoker = on) as
select
  count(*) as visitors,
  count(downloaded_at) as downloaded,
  count(installed_at) as installed,
  count(signed_up_at) as accounts,
  count(paired_at) as paired,
  count(first_session_at) as activated,
  count(second_session_at) as habit_forming,
  count(trial_at) as trials,
  count(paid_at) as paid,
  percentile_cont(0.5) within group (
    order by extract(epoch from (downloaded_at - visited_at))
  ) filter (where visited_at is not null and downloaded_at >= visited_at) as median_visit_to_download_seconds,
  percentile_cont(0.5) within group (
    order by extract(epoch from (first_session_at - installed_at))
  ) filter (where installed_at is not null and first_session_at >= installed_at) as median_install_to_value_seconds
from public.analytics_dev_funnel
where first_seen_at >= now() - interval '90 days';

-- 0010 correctly moved most usage metrics onto analytics_usage_resolved, but these installed
-- base and retention subqueries still used the raw table. Rebuild them so the production and
-- dev audiences are disjoint across every activity metric.
create or replace view public.analytics_engagement_daily
with (security_invoker = on) as
select
  d.local_date,
  d.devices_reporting,
  d.dau_protected,
  d.dau_ui,
  d.people_protected,
  d.total_focus_hours,
  d.avg_active_focus_minutes,
  round((d.median_focus_seconds / 60.0)::numeric, 1) as median_focus_minutes,
  d.sessions_completed,
  d.sessions_aborted,
  round(sum(u.scheduled_focus_seconds) / 3600.0, 1) as scheduled_focus_hours,
  round(sum(greatest(u.focus_seconds - u.scheduled_focus_seconds, 0)) / 3600.0, 1) as manual_focus_hours,
  (
    select count(distinct coalesce(m.person_id::text, m.device_id::text))
    from public.analytics_usage_resolved m
    where m.local_date > d.local_date - 30
      and m.local_date <= d.local_date
      and m.focus_seconds >= 60
  ) as mau_protected,
  (
    select count(distinct b.device_id)
    from public.analytics_usage_resolved b
    where b.local_date > d.local_date - 30 and b.local_date <= d.local_date
  ) as installed_base_30d
from public.analytics_dau d
join public.analytics_usage_resolved u on u.local_date = d.local_date
group by d.local_date, d.devices_reporting, d.dau_protected, d.dau_ui,
  d.people_protected, d.total_focus_hours, d.avg_active_focus_minutes,
  d.median_focus_seconds, d.sessions_completed, d.sessions_aborted;

create or replace view public.analytics_dev_engagement_daily
with (security_invoker = on) as
select
  d.local_date,
  d.devices_reporting,
  d.dau_protected,
  d.dau_ui,
  d.people_protected,
  d.total_focus_hours,
  d.avg_active_focus_minutes,
  round((d.median_focus_seconds / 60.0)::numeric, 1) as median_focus_minutes,
  d.sessions_completed,
  d.sessions_aborted,
  round(sum(u.scheduled_focus_seconds) / 3600.0, 1) as scheduled_focus_hours,
  round(sum(greatest(u.focus_seconds - u.scheduled_focus_seconds, 0)) / 3600.0, 1) as manual_focus_hours,
  (
    select count(distinct coalesce(m.person_id::text, m.device_id::text))
    from public.analytics_dev_usage_resolved m
    where m.local_date > d.local_date - 30
      and m.local_date <= d.local_date
      and m.focus_seconds >= 60
  ) as mau_protected,
  (
    select count(distinct b.device_id)
    from public.analytics_dev_usage_resolved b
    where b.local_date > d.local_date - 30 and b.local_date <= d.local_date
  ) as installed_base_30d
from public.analytics_dev_dau d
join public.analytics_dev_usage_resolved u on u.local_date = d.local_date
group by d.local_date, d.devices_reporting, d.dau_protected, d.dau_ui,
  d.people_protected, d.total_focus_hours, d.avg_active_focus_minutes,
  d.median_focus_seconds, d.sessions_completed, d.sessions_aborted;

create or replace view public.analytics_retention_cohorts
with (security_invoker = on) as
with usage_first as (
  select device_id, min(local_date) as first_reported_on
  from public.analytics_usage_resolved
  group by device_id
), event_first as (
  select device_id, min(occurred_at::date) as installed_event_on
  from public.analytics_events_resolved
  where event = 'app_installed' and device_id is not null
  group by device_id
), cohort as (
  select coalesce(e.device_id, u.device_id) as device_id,
         coalesce(e.installed_event_on, u.first_reported_on) as installed_on
  from event_first e
  full join usage_first u using (device_id)
)
select
  date_trunc('week', c.installed_on)::date as cohort_week,
  count(*) as devices,
  count(*) filter (where c.installed_on <= current_date - 1) as eligible_d1,
  count(*) filter (where c.installed_on <= current_date - 5) as eligible_d7,
  count(*) filter (where c.installed_on <= current_date - 27) as eligible_d30,
  count(*) filter (where exists (
    select 1 from public.analytics_usage_resolved u
    where u.device_id = c.device_id
      and u.local_date between c.installed_on + 1 and c.installed_on + 2
      and u.focus_seconds >= 60
  )) as d1_protected,
  count(*) filter (where exists (
    select 1 from public.analytics_usage_resolved u
    where u.device_id = c.device_id
      and u.local_date between c.installed_on + 5 and c.installed_on + 9
      and u.focus_seconds >= 60
  )) as d7_protected,
  count(*) filter (where exists (
    select 1 from public.analytics_usage_resolved u
    where u.device_id = c.device_id
      and u.local_date between c.installed_on + 27 and c.installed_on + 33
      and u.focus_seconds >= 60
  )) as d30_protected
from cohort c
where c.installed_on is not null
group by 1;

create or replace view public.analytics_dev_retention_cohorts
with (security_invoker = on) as
with usage_first as (
  select device_id, min(local_date) as first_reported_on
  from public.analytics_dev_usage_resolved
  group by device_id
), event_first as (
  select device_id, min(occurred_at::date) as installed_event_on
  from public.analytics_dev_events_resolved
  where event = 'app_installed' and device_id is not null
  group by device_id
), cohort as (
  select coalesce(e.device_id, u.device_id) as device_id,
         coalesce(e.installed_event_on, u.first_reported_on) as installed_on
  from event_first e
  full join usage_first u using (device_id)
)
select
  date_trunc('week', c.installed_on)::date as cohort_week,
  count(*) as devices,
  count(*) filter (where c.installed_on <= current_date - 1) as eligible_d1,
  count(*) filter (where c.installed_on <= current_date - 5) as eligible_d7,
  count(*) filter (where c.installed_on <= current_date - 27) as eligible_d30,
  count(*) filter (where exists (
    select 1 from public.analytics_dev_usage_resolved u
    where u.device_id = c.device_id
      and u.local_date between c.installed_on + 1 and c.installed_on + 2
      and u.focus_seconds >= 60
  )) as d1_protected,
  count(*) filter (where exists (
    select 1 from public.analytics_dev_usage_resolved u
    where u.device_id = c.device_id
      and u.local_date between c.installed_on + 5 and c.installed_on + 9
      and u.focus_seconds >= 60
  )) as d7_protected,
  count(*) filter (where exists (
    select 1 from public.analytics_dev_usage_resolved u
    where u.device_id = c.device_id
      and u.local_date between c.installed_on + 27 and c.installed_on + 33
      and u.focus_seconds >= 60
  )) as d30_protected
from cohort c
where c.installed_on is not null
group by 1;

create or replace view public.analytics_dev_install_health
with (security_invoker = on) as
with event_base as (
  select
    coalesce(person_id::text, device_id::text, anon_id::text, 'event:' || id::text) as entity_id,
    coalesce(platform, props->>'platform', 'unknown') as platform,
    event,
    props
  from public.analytics_dev_events_resolved
  where event in ('app_installed', 'service_installed', 'service_install_failed', 'extension_connected')
), milestones as (
  select
    entity_id,
    platform,
    bool_or(event = 'app_installed') as app_installed,
    bool_or(event = 'service_installed') as service_installed,
    bool_or(event = 'extension_connected') as extension_connected
  from event_base
  group by entity_id, platform
), totals as (
  select
    platform,
    null::text as failure_reason,
    count(*) filter (where app_installed) as app_installed,
    count(*) filter (where service_installed) as service_installed,
    count(*) filter (where extension_connected) as extension_connected,
    0::bigint as install_failed
  from milestones
  group by platform
), failures as (
  select
    platform,
    coalesce(nullif(props->>'reason', ''), 'unknown') as failure_reason,
    0::bigint as app_installed,
    0::bigint as service_installed,
    0::bigint as extension_connected,
    count(*) as install_failed
  from event_base
  where event = 'service_install_failed'
  group by platform, 2
)
select * from totals
union all
select * from failures;

-- Subscription snapshots are keyed by user_id rather than an analytics event, so partition
-- them against both ignore lists. Event-derived billing signals use the resolved audience view.
create or replace view public.analytics_revenue_summary
with (security_invoker = on) as
select
  (select count(*) from public.subscriptions s
    where s.status = 'active' and s.current_period_end > now()
      and not exists (select 1 from public.analytics_ignored_users g where g.user_id = s.user_id)
      and not exists (
        select 1 from public.analytics_ignored_persons g
        join public.analytics_persons p on p.id = g.person_id
        where p.user_id = s.user_id
      )) as active_subscriptions,
  (select count(*) from public.subscriptions s
    where s.status = 'trialing' and s.current_period_end > now()
      and not exists (select 1 from public.analytics_ignored_users g where g.user_id = s.user_id)
      and not exists (
        select 1 from public.analytics_ignored_persons g
        join public.analytics_persons p on p.id = g.person_id
        where p.user_id = s.user_id
      )) as active_trials,
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

create or replace view public.analytics_dev_revenue_summary
with (security_invoker = on) as
select
  (select count(*) from public.subscriptions s
    where s.status = 'active' and s.current_period_end > now()
      and (
        exists (select 1 from public.analytics_ignored_users g where g.user_id = s.user_id)
        or exists (
          select 1 from public.analytics_ignored_persons g
          join public.analytics_persons p on p.id = g.person_id
          where p.user_id = s.user_id
        )
      )) as active_subscriptions,
  (select count(*) from public.subscriptions s
    where s.status = 'trialing' and s.current_period_end > now()
      and (
        exists (select 1 from public.analytics_ignored_users g where g.user_id = s.user_id)
        or exists (
          select 1 from public.analytics_ignored_persons g
          join public.analytics_persons p on p.id = g.person_id
          where p.user_id = s.user_id
        )
      )) as active_trials,
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
from public.analytics_dev_events_resolved;

revoke all on public.analytics_dev_events_resolved from anon, authenticated;
revoke all on public.analytics_dev_usage_resolved from anon, authenticated;
revoke all on public.analytics_dev_funnel from anon, authenticated;
revoke all on public.analytics_dev_dau from anon, authenticated;
revoke all on public.analytics_dev_channel_funnel from anon, authenticated;
revoke all on public.analytics_dev_funnel_summary from anon, authenticated;
revoke all on public.analytics_dev_engagement_daily from anon, authenticated;
revoke all on public.analytics_dev_retention_cohorts from anon, authenticated;
revoke all on public.analytics_dev_install_health from anon, authenticated;
revoke all on public.analytics_dev_revenue_summary from anon, authenticated;

grant select on public.analytics_dev_events_resolved to service_role;
grant select on public.analytics_dev_usage_resolved to service_role;
grant select on public.analytics_dev_funnel to service_role;
grant select on public.analytics_dev_dau to service_role;
grant select on public.analytics_dev_channel_funnel to service_role;
grant select on public.analytics_dev_funnel_summary to service_role;
grant select on public.analytics_dev_engagement_daily to service_role;
grant select on public.analytics_dev_retention_cohorts to service_role;
grant select on public.analytics_dev_install_health to service_role;
grant select on public.analytics_dev_revenue_summary to service_role;
