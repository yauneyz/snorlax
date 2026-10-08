-- Which search pages earn their keep: the acquisition funnel split by the page a visitor first
-- landed on, over the last 90 days.
--
-- Two attributions, side by side, because they answer different questions:
--   * first-touch (visitors .. paid): people whose first page was this one, and how far they got.
--   * cta_downloads: people who started a download from this page's CTA (`download_clicked`
--     carrying `from`, set by /download?from=<slug>), whatever page they first landed on.
-- Only web visitors count: a person with no human page_viewed has no landing page to file under.

create or replace view public.analytics_landing_funnel
with (security_invoker = on) as
with first_touch as (
  select
    p.first_landing_path as landing_path,
    count(*) as visitors,
    count(*) filter (
      where p.first_utm_medium is null
        and p.first_referrer_host ~* '(^|\.)(google\.|bing\.com$|duckduckgo\.com$|yahoo\.)'
    ) as organic_visitors,
    count(f.downloaded_at) as downloaded,
    count(f.installed_at) as installed,
    count(f.first_session_at) as activated,
    count(f.paid_at) as paid
  from public.analytics_funnel f
  join public.analytics_persons p on p.id = f.person_id
  where f.first_seen_at >= now() - interval '90 days'
    and f.visited_at is not null
    and p.first_landing_path is not null
  group by 1
), cta as (
  select '/' || (props->>'from') as landing_path, count(distinct person_id) as cta_downloads
  from public.analytics_events_resolved
  where event = 'download_clicked'
    and props->>'from' ~ '^[a-z0-9-]{1,128}$'
    and occurred_at >= now() - interval '90 days'
  group by 1
)
select
  coalesce(t.landing_path, c.landing_path) as landing_path,
  coalesce(t.visitors, 0) as visitors,
  coalesce(t.organic_visitors, 0) as organic_visitors,
  coalesce(t.downloaded, 0) as downloaded,
  coalesce(t.installed, 0) as installed,
  coalesce(t.activated, 0) as activated,
  coalesce(t.paid, 0) as paid,
  coalesce(c.cta_downloads, 0) as cta_downloads
from first_touch t
full outer join cta c on c.landing_path = t.landing_path;

create or replace view public.analytics_dev_landing_funnel
with (security_invoker = on) as
with first_touch as (
  select
    p.first_landing_path as landing_path,
    count(*) as visitors,
    count(*) filter (
      where p.first_utm_medium is null
        and p.first_referrer_host ~* '(^|\.)(google\.|bing\.com$|duckduckgo\.com$|yahoo\.)'
    ) as organic_visitors,
    count(f.downloaded_at) as downloaded,
    count(f.installed_at) as installed,
    count(f.first_session_at) as activated,
    count(f.paid_at) as paid
  from public.analytics_dev_funnel f
  join public.analytics_persons p on p.id = f.person_id
  where f.first_seen_at >= now() - interval '90 days'
    and f.visited_at is not null
    and p.first_landing_path is not null
  group by 1
), cta as (
  select '/' || (props->>'from') as landing_path, count(distinct person_id) as cta_downloads
  from public.analytics_dev_events_resolved
  where event = 'download_clicked'
    and props->>'from' ~ '^[a-z0-9-]{1,128}$'
    and occurred_at >= now() - interval '90 days'
  group by 1
)
select
  coalesce(t.landing_path, c.landing_path) as landing_path,
  coalesce(t.visitors, 0) as visitors,
  coalesce(t.organic_visitors, 0) as organic_visitors,
  coalesce(t.downloaded, 0) as downloaded,
  coalesce(t.installed, 0) as installed,
  coalesce(t.activated, 0) as activated,
  coalesce(t.paid, 0) as paid,
  coalesce(c.cta_downloads, 0) as cta_downloads
from first_touch t
full outer join cta c on c.landing_path = t.landing_path;

revoke all on public.analytics_landing_funnel from anon, authenticated;
revoke all on public.analytics_dev_landing_funnel from anon, authenticated;
grant select on public.analytics_landing_funnel to service_role;
grant select on public.analytics_dev_landing_funnel to service_role;
