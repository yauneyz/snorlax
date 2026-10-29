-- Blog posts as an acquisition channel, and a per-post performance view.
--
-- Attribution rules:
--   * Anyone who read a blog post before converting is filed under the FIRST post they read.
--   * If they then click the universal CTA at the bottom of a DIFFERENT post (`blog_cta_clicked`,
--     props.slug), they land in a hybrid channel "first → clicked". A CTA on the same post they
--     first read keeps the plain channel.
--   * Only touches before the person's first conversion count. A customer who reads a post after
--     downloading keeps the channel that actually earned them, so the blog is never credited
--     with people it didn't bring in.
--   * An affiliate still wins over the blog (it's what the affiliate is paid on); the blog wins
--     over plain first-touch (google, reddit.com, direct, ...).
--
-- Derived from events at read time rather than stamped onto analytics_persons, so it covers
-- history from before this migration and survives identity merges without carry-over logic:
-- events keep raw identifiers and re-resolve to whichever person now owns them.
-- channelOf() in src/server/analytics/channel.ts mirrors the channel expressions and must stay
-- in step.

-- One row per person with any pre-conversion blog touch. Covers both audiences; the funnels that
-- join it already restrict to one.
create or replace view public.analytics_blog_touch
with (security_invoker = on) as
with resolved as (
  select
    e.event,
    e.occurred_at,
    e.props,
    coalesce(iu.person_id, idv.person_id, ia.person_id) as person_id
  from public.analytics_events e
  left join public.analytics_identities iu  on iu.identifier  = 'user:'   || e.user_id::text
  left join public.analytics_identities idv on idv.identifier = 'device:' || e.device_id::text
  left join public.analytics_identities ia  on ia.identifier  = 'anon:'   || e.anon_id::text
  where e.event in (
      'page_viewed', 'blog_cta_clicked', 'download_clicked', 'app_installed',
      'account_created', 'trial_started', 'subscription_started'
    )
    and coalesce(e.props->>'ua_class', '') <> 'bot'
), converted as (
  select person_id, min(occurred_at) as converted_at
  from resolved
  where event in ('download_clicked', 'app_installed', 'account_created', 'trial_started', 'subscription_started')
  group by 1
), touches as (
  select
    r.person_id,
    r.event,
    r.occurred_at,
    case
      when r.event = 'page_viewed' then substring(r.props->>'path' from '^/blog/([a-z0-9-]+)/?$')
      when r.props->>'slug' ~ '^[a-z0-9-]{1,128}$' then r.props->>'slug'
    end as slug
  from resolved r
  left join converted c on c.person_id = r.person_id
  where r.person_id is not null
    and r.event in ('page_viewed', 'blog_cta_clicked')
    and r.occurred_at < coalesce(c.converted_at, 'infinity')
), first_read as (
  -- A CTA click is also proof of a read, in case its page_viewed was lost.
  select distinct on (person_id) person_id, slug, occurred_at
  from touches
  where slug is not null
  order by person_id, occurred_at, event = 'blog_cta_clicked'
), first_cta as (
  select distinct on (person_id) person_id, slug, occurred_at
  from touches
  where slug is not null and event = 'blog_cta_clicked'
  order by person_id, occurred_at
)
select
  r.person_id,
  r.slug as first_slug,
  r.occurred_at as first_at,
  c.slug as cta_slug,
  c.occurred_at as cta_at,
  case
    when c.slug is not null and c.slug <> r.slug then r.slug || ' → ' || c.slug
    else r.slug
  end as channel
from first_read r
left join first_cta c on c.person_id = r.person_id;

-- 0020's channel funnel with the blog between the affiliate and first-touch.
create or replace view public.analytics_channel_funnel
with (security_invoker = on) as
select
  coalesce(
    a.slug,
    bt.channel,
    f.first_utm_source,
    case
      when f.first_referrer_host ~* '(^|\.)google\.' then 'google'
      when f.first_referrer_host ~* '(^|\.)bing\.com$' then 'bing'
      when f.first_referrer_host ~* '(^|\.)duckduckgo\.com$' then 'duckduckgo'
      when f.first_referrer_host ~* '(^|\.)yahoo\.' then 'yahoo'
      else f.first_referrer_host
    end,
    'direct'
  ) as channel,
  case
    when a.slug is not null then 'affiliate'
    when bt.channel is not null then 'blog'
    else coalesce(
      f.first_utm_medium,
      case
        when f.first_referrer_host ~* '(^|\.)(google\.|bing\.com$|duckduckgo\.com$|yahoo\.)' then 'organic'
        when f.first_referrer_host is not null then 'referral'
        else 'none'
      end
    )
  end as medium,
  count(*) as visitors,
  count(f.downloaded_at) as downloaded,
  count(f.installed_at) as installed,
  count(f.signed_up_at) as accounts,
  count(f.paired_at) as paired,
  count(f.first_session_at) as activated,
  count(f.second_session_at) as habit_forming,
  count(f.trial_at) as trials,
  count(f.paid_at) as paid,
  round(100.0 * count(f.paid_at) / nullif(count(*), 0), 2) as pct_visitor_to_paid
from public.analytics_funnel f
join public.analytics_persons p on p.id = f.person_id
left join public.affiliates a on a.id = p.affiliate_id
left join public.analytics_blog_touch bt on bt.person_id = f.person_id
where f.first_seen_at >= now() - interval '90 days'
group by 1, 2;

-- 0020's channel funnel with the blog between the affiliate and first-touch.
create or replace view public.analytics_dev_channel_funnel
with (security_invoker = on) as
select
  coalesce(
    a.slug,
    bt.channel,
    f.first_utm_source,
    case
      when f.first_referrer_host ~* '(^|\.)google\.' then 'google'
      when f.first_referrer_host ~* '(^|\.)bing\.com$' then 'bing'
      when f.first_referrer_host ~* '(^|\.)duckduckgo\.com$' then 'duckduckgo'
      when f.first_referrer_host ~* '(^|\.)yahoo\.' then 'yahoo'
      else f.first_referrer_host
    end,
    'direct'
  ) as channel,
  case
    when a.slug is not null then 'affiliate'
    when bt.channel is not null then 'blog'
    else coalesce(
      f.first_utm_medium,
      case
        when f.first_referrer_host ~* '(^|\.)(google\.|bing\.com$|duckduckgo\.com$|yahoo\.)' then 'organic'
        when f.first_referrer_host is not null then 'referral'
        else 'none'
      end
    )
  end as medium,
  count(*) as visitors,
  count(f.downloaded_at) as downloaded,
  count(f.installed_at) as installed,
  count(f.signed_up_at) as accounts,
  count(f.paired_at) as paired,
  count(f.first_session_at) as activated,
  count(f.second_session_at) as habit_forming,
  count(f.trial_at) as trials,
  count(f.paid_at) as paid,
  round(100.0 * count(f.paid_at) / nullif(count(*), 0), 2) as pct_visitor_to_paid
from public.analytics_dev_funnel f
join public.analytics_persons p on p.id = f.person_id
left join public.affiliates a on a.id = p.affiliate_id
left join public.analytics_blog_touch bt on bt.person_id = f.person_id
where f.first_seen_at >= now() - interval '90 days'
group by 1, 2;

-- Per-post performance over the last 90 days.
--   Traffic: human views, views in the last 7 days, distinct readers, and entrances (people whose
--     very first page on the site was this post).
--   cta_clickers: distinct people who clicked the post's CTA.
--   attributed .. paid: people whose blog channel starts with this post (its first read), and how
--     far they got. Every step here happened after the read -- see analytics_blog_touch.
--   linked .. linked_paid: people LINKED to the post -- they read it first, or clicked its CTA
--     before converting -- and how far they got. A hybrid "a → b" person is linked to both posts,
--     so these columns overlap across posts; the attributed columns never do.

create or replace view public.analytics_blog_posts
with (security_invoker = on) as
with views as (
  select
    substring(props->>'path' from '^/blog/([a-z0-9-]+)/?$') as slug,
    person_id,
    occurred_at
  from public.analytics_events_resolved
  where event = 'page_viewed'
    and coalesce(props->>'ua_class', '') <> 'bot'
    and occurred_at >= now() - interval '90 days'
), traffic as (
  select
    slug,
    count(*) as views,
    count(*) filter (where occurred_at >= now() - interval '7 days') as views_7d,
    count(distinct person_id) as visitors
  from views
  where slug is not null
  group by 1
), entrances as (
  select substring(p.first_landing_path from '^/blog/([a-z0-9-]+)/?$') as slug, count(*) as entrances
  from public.analytics_funnel f
  join public.analytics_persons p on p.id = f.person_id
  where f.first_seen_at >= now() - interval '90 days'
    and f.visited_at is not null
  group by 1
), cta as (
  select props->>'slug' as slug, count(distinct person_id) as cta_clickers
  from public.analytics_events_resolved
  where event = 'blog_cta_clicked'
    and props->>'slug' ~ '^[a-z0-9-]{1,128}$'
    and coalesce(props->>'ua_class', '') <> 'bot'
    and occurred_at >= now() - interval '90 days'
  group by 1
), attributed as (
  select
    bt.first_slug as slug,
    count(*) as attributed,
    count(f.downloaded_at) as downloaded,
    count(f.installed_at) as installed,
    count(f.paired_at) as paired,
    count(f.first_session_at) as activated,
    count(f.trial_at) as trials,
    count(f.paid_at) as paid
  from public.analytics_blog_touch bt
  join public.analytics_funnel f on f.person_id = bt.person_id
  where bt.first_at >= now() - interval '90 days'
  group by 1
), linked as (
  -- One row per (post, person) for the post they read first and the post whose CTA they
  -- clicked; the union collapses the two when they're the same post.
  select bt.first_slug as slug, bt.person_id from public.analytics_blog_touch bt
  where bt.first_at >= now() - interval '90 days'
  union
  select bt.cta_slug, bt.person_id from public.analytics_blog_touch bt
  where bt.cta_slug is not null and bt.cta_at >= now() - interval '90 days'
), via_linked as (
  select
    l.slug,
    count(*) as linked,
    count(f.downloaded_at) as linked_downloaded,
    count(f.paired_at) as linked_paired,
    count(f.trial_at) as linked_trials,
    count(f.paid_at) as linked_paid
  from linked l
  join public.analytics_funnel f on f.person_id = l.person_id
  group by 1
), slugs as (
  select slug from traffic
  union select slug from cta
  union select slug from via_linked
)
select
  s.slug,
  coalesce(t.views, 0) as views,
  coalesce(t.views_7d, 0) as views_7d,
  coalesce(t.visitors, 0) as visitors,
  coalesce(e.entrances, 0) as entrances,
  coalesce(c.cta_clickers, 0) as cta_clickers,
  coalesce(a.attributed, 0) as attributed,
  coalesce(a.downloaded, 0) as downloaded,
  coalesce(a.installed, 0) as installed,
  coalesce(a.paired, 0) as paired,
  coalesce(a.activated, 0) as activated,
  coalesce(a.trials, 0) as trials,
  coalesce(a.paid, 0) as paid,
  coalesce(v.linked, 0) as linked,
  coalesce(v.linked_downloaded, 0) as linked_downloaded,
  coalesce(v.linked_paired, 0) as linked_paired,
  coalesce(v.linked_trials, 0) as linked_trials,
  coalesce(v.linked_paid, 0) as linked_paid
from slugs s
left join traffic t on t.slug = s.slug
left join entrances e on e.slug = s.slug
left join cta c on c.slug = s.slug
left join attributed a on a.slug = s.slug
left join via_linked v on v.slug = s.slug;

create or replace view public.analytics_dev_blog_posts
with (security_invoker = on) as
with views as (
  select
    substring(props->>'path' from '^/blog/([a-z0-9-]+)/?$') as slug,
    person_id,
    occurred_at
  from public.analytics_dev_events_resolved
  where event = 'page_viewed'
    and coalesce(props->>'ua_class', '') <> 'bot'
    and occurred_at >= now() - interval '90 days'
), traffic as (
  select
    slug,
    count(*) as views,
    count(*) filter (where occurred_at >= now() - interval '7 days') as views_7d,
    count(distinct person_id) as visitors
  from views
  where slug is not null
  group by 1
), entrances as (
  select substring(p.first_landing_path from '^/blog/([a-z0-9-]+)/?$') as slug, count(*) as entrances
  from public.analytics_dev_funnel f
  join public.analytics_persons p on p.id = f.person_id
  where f.first_seen_at >= now() - interval '90 days'
    and f.visited_at is not null
  group by 1
), cta as (
  select props->>'slug' as slug, count(distinct person_id) as cta_clickers
  from public.analytics_dev_events_resolved
  where event = 'blog_cta_clicked'
    and props->>'slug' ~ '^[a-z0-9-]{1,128}$'
    and coalesce(props->>'ua_class', '') <> 'bot'
    and occurred_at >= now() - interval '90 days'
  group by 1
), attributed as (
  select
    bt.first_slug as slug,
    count(*) as attributed,
    count(f.downloaded_at) as downloaded,
    count(f.installed_at) as installed,
    count(f.paired_at) as paired,
    count(f.first_session_at) as activated,
    count(f.trial_at) as trials,
    count(f.paid_at) as paid
  from public.analytics_blog_touch bt
  join public.analytics_dev_funnel f on f.person_id = bt.person_id
  where bt.first_at >= now() - interval '90 days'
  group by 1
), linked as (
  -- One row per (post, person) for the post they read first and the post whose CTA they
  -- clicked; the union collapses the two when they're the same post.
  select bt.first_slug as slug, bt.person_id from public.analytics_blog_touch bt
  where bt.first_at >= now() - interval '90 days'
  union
  select bt.cta_slug, bt.person_id from public.analytics_blog_touch bt
  where bt.cta_slug is not null and bt.cta_at >= now() - interval '90 days'
), via_linked as (
  select
    l.slug,
    count(*) as linked,
    count(f.downloaded_at) as linked_downloaded,
    count(f.paired_at) as linked_paired,
    count(f.trial_at) as linked_trials,
    count(f.paid_at) as linked_paid
  from linked l
  join public.analytics_dev_funnel f on f.person_id = l.person_id
  group by 1
), slugs as (
  select slug from traffic
  union select slug from cta
  union select slug from via_linked
)
select
  s.slug,
  coalesce(t.views, 0) as views,
  coalesce(t.views_7d, 0) as views_7d,
  coalesce(t.visitors, 0) as visitors,
  coalesce(e.entrances, 0) as entrances,
  coalesce(c.cta_clickers, 0) as cta_clickers,
  coalesce(a.attributed, 0) as attributed,
  coalesce(a.downloaded, 0) as downloaded,
  coalesce(a.installed, 0) as installed,
  coalesce(a.paired, 0) as paired,
  coalesce(a.activated, 0) as activated,
  coalesce(a.trials, 0) as trials,
  coalesce(a.paid, 0) as paid,
  coalesce(v.linked, 0) as linked,
  coalesce(v.linked_downloaded, 0) as linked_downloaded,
  coalesce(v.linked_paired, 0) as linked_paired,
  coalesce(v.linked_trials, 0) as linked_trials,
  coalesce(v.linked_paid, 0) as linked_paid
from slugs s
left join traffic t on t.slug = s.slug
left join entrances e on e.slug = s.slug
left join cta c on c.slug = s.slug
left join attributed a on a.slug = s.slug
left join via_linked v on v.slug = s.slug;

revoke all on public.analytics_blog_touch from anon, authenticated;
revoke all on public.analytics_channel_funnel from anon, authenticated;
revoke all on public.analytics_dev_channel_funnel from anon, authenticated;
revoke all on public.analytics_blog_posts from anon, authenticated;
revoke all on public.analytics_dev_blog_posts from anon, authenticated;
grant select on public.analytics_blog_touch to service_role;
grant select on public.analytics_channel_funnel to service_role;
grant select on public.analytics_dev_channel_funnel to service_role;
grant select on public.analytics_blog_posts to service_role;
grant select on public.analytics_dev_blog_posts to service_role;
