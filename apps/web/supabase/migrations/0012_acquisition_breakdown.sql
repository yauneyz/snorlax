-- Acquisition reporting for the early traffic -> download -> install -> paid funnel.
-- Device and OS are deliberately coarse labels captured on page_viewed; raw user-agent
-- strings never enter analytics_events.

-- Upgrade unattributed referrers into useful channel/medium buckets. Explicit UTMs still
-- win, including paid-click ids translated to UTMs by the ingest route.
create or replace view public.analytics_channel_funnel
with (security_invoker = on) as
select
  coalesce(
    first_utm_source,
    case
      when first_referrer_host ~* '(^|\.)google\.' then 'google'
      when first_referrer_host ~* '(^|\.)bing\.com$' then 'bing'
      when first_referrer_host ~* '(^|\.)duckduckgo\.com$' then 'duckduckgo'
      when first_referrer_host ~* '(^|\.)yahoo\.' then 'yahoo'
      else first_referrer_host
    end,
    'direct'
  ) as channel,
  coalesce(
    first_utm_medium,
    case
      when first_referrer_host ~* '(^|\.)(google\.|bing\.com$|duckduckgo\.com$|yahoo\.)' then 'organic'
      when first_referrer_host is not null then 'referral'
      else 'none'
    end
  ) as medium,
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
from public.analytics_funnel
where first_seen_at >= now() - interval '90 days'
group by 1, 2;

create or replace view public.analytics_dev_channel_funnel
with (security_invoker = on) as
select
  coalesce(
    first_utm_source,
    case
      when first_referrer_host ~* '(^|\.)google\.' then 'google'
      when first_referrer_host ~* '(^|\.)bing\.com$' then 'bing'
      when first_referrer_host ~* '(^|\.)duckduckgo\.com$' then 'duckduckgo'
      when first_referrer_host ~* '(^|\.)yahoo\.' then 'yahoo'
      else first_referrer_host
    end,
    'direct'
  ) as channel,
  coalesce(
    first_utm_medium,
    case
      when first_referrer_host ~* '(^|\.)(google\.|bing\.com$|duckduckgo\.com$|yahoo\.)' then 'organic'
      when first_referrer_host is not null then 'referral'
      else 'none'
    end
  ) as medium,
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

create or replace view public.analytics_visitor_breakdown
with (security_invoker = on) as
with first_visits as (
  select distinct on (person_id)
    person_id,
    coalesce(nullif(props->>'device_type', ''), 'Unknown') as device_type,
    coalesce(nullif(props->>'os', ''), 'Unknown') as os
  from public.analytics_events_resolved
  where event = 'page_viewed'
    and person_id is not null
    and occurred_at >= now() - interval '90 days'
    and coalesce(props->>'ua_class', 'human') <> 'bot'
  order by person_id, occurred_at
), dimensions as (
  select 'device_type'::text as dimension, device_type as value from first_visits
  union all
  select 'os'::text as dimension, os as value from first_visits
)
select dimension, value, count(*) as visitors
from dimensions
group by dimension, value;

create or replace view public.analytics_dev_visitor_breakdown
with (security_invoker = on) as
with first_visits as (
  select distinct on (person_id)
    person_id,
    coalesce(nullif(props->>'device_type', ''), 'Unknown') as device_type,
    coalesce(nullif(props->>'os', ''), 'Unknown') as os
  from public.analytics_dev_events_resolved
  where event = 'page_viewed'
    and person_id is not null
    and occurred_at >= now() - interval '90 days'
    and coalesce(props->>'ua_class', 'human') <> 'bot'
  order by person_id, occurred_at
), dimensions as (
  select 'device_type'::text as dimension, device_type as value from first_visits
  union all
  select 'os'::text as dimension, os as value from first_visits
)
select dimension, value, count(*) as visitors
from dimensions
group by dimension, value;

revoke all on public.analytics_visitor_breakdown from anon, authenticated;
revoke all on public.analytics_dev_visitor_breakdown from anon, authenticated;
grant select on public.analytics_visitor_breakdown to service_role;
grant select on public.analytics_dev_visitor_breakdown to service_role;
