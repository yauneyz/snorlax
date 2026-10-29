-- The channel trail: every person keeps three attribution layers side by side instead of one
-- winner, so journeys like "chatgpt → attention-armor (blog) → maya (affiliate)" are visible.
--
--   source     the outside world that brought them: search, AI assistants, social, referral
--              sites, tagged campaigns, or direct. First touch, never overwritten. An affiliate
--              link's own UTMs are not a source -- the page the link was clicked on is.
--   blog       the blog channel from analytics_blog_touch (0021): first post read before
--              converting, or "first → clicked" when the CTA was clicked on another post.
--   affiliate  the first affiliate link they used (0020).
--
-- Single-winner reporting (analytics_channel_funnel) keeps affiliate > blog > source, with the
-- source now named by analytics_source() below so every panel uses the same names.
--
-- Also: "active" trials and subscriptions exclude anything set to cancel at period end. Someone
-- who has decided to leave is still entitled until the period ends, but counting them as active
-- revenue overstates what's coming.

-- ---------------------------------------------------------------------------
-- Source naming
-- ---------------------------------------------------------------------------

-- A host or utm_source value, named and classified. First matching pattern wins, so the
-- specific ones (gemini.google.com, accounts.google.com) sit above the general ones.
create or replace function public.analytics_host_source(p_value text, out name text, out kind text)
language sql
immutable
parallel safe
set search_path = public
as $$
  select coalesce(m.name, x.h), coalesce(m.kind, 'referral')
  from (select lower(regexp_replace(trim(coalesce(p_value, '')), '^(www|m)\.', '', 'i')) as h) x
  left join lateral (
    select v.name, v.kind
    from (values
      -- Our own sign-in and checkout round trips: the visit started here.
      (10, '(^|\.)(accounts\.google\.com|checkout\.stripe\.com|billing\.stripe\.com|talysman\.app)$', 'direct', 'direct'),
      -- AI assistants.
      (20, '(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com)$|^chatgpt$', 'chatgpt', 'ai'),
      (21, '(^|\.)perplexity\.ai$|^perplexity$', 'perplexity', 'ai'),
      (22, '(^|\.)claude\.ai$|^claude$', 'claude', 'ai'),
      (23, '(^|\.)(gemini|bard)\.google\.com$|^gemini$', 'gemini', 'ai'),
      (24, '(^|\.)copilot\.microsoft\.com$|^copilot$', 'copilot', 'ai'),
      (25, '(^|\.)deepseek\.com$|^deepseek$', 'deepseek', 'ai'),
      (26, '(^|\.)grok\.com$|^grok$', 'grok', 'ai'),
      (27, '(^|\.)meta\.ai$', 'meta ai', 'ai'),
      (28, '(^|\.)(you|phind)\.com$', 'ai search', 'ai'),
      -- Search engines.
      (40, '(^|\.)google(\.[a-z.]+)?$', 'google', 'search'),
      (41, '(^|\.)bing(\.com)?$', 'bing', 'search'),
      (42, '(^|\.)duckduckgo(\.com)?$', 'duckduckgo', 'search'),
      (43, '(^|\.)yahoo(\.[a-z.]+)?$', 'yahoo', 'search'),
      (44, '(^|\.)search\.brave\.com$|^brave$', 'brave', 'search'),
      (45, '(^|\.)ecosia(\.org)?$', 'ecosia', 'search'),
      (46, '(^|\.)kagi(\.com)?$', 'kagi', 'search'),
      (47, '(^|\.)yandex(\.[a-z.]+)?$', 'yandex', 'search'),
      (48, '(^|\.)baidu\.com$', 'baidu', 'search'),
      -- Social and communities.
      (60, '(^|\.)(reddit\.com|redd\.it)$|^reddit$', 'reddit', 'social'),
      (61, '(^|\.)(youtube\.com|youtu\.be)$|^youtube$', 'youtube', 'social'),
      (62, '(^|\.)(x\.com|t\.co|twitter\.com)$|^(x|twitter)$', 'x', 'social'),
      (63, '(^|\.)(facebook\.com|fb\.com|fb\.me)$|^(facebook|fb)$', 'facebook', 'social'),
      (64, '(^|\.)instagram\.com$|^(instagram|ig)$', 'instagram', 'social'),
      (65, '(^|\.)(linkedin\.com|lnkd\.in)$|^linkedin$', 'linkedin', 'social'),
      (66, '(^|\.)news\.ycombinator\.com$|^(hn|hackernews)$', 'hacker news', 'social'),
      (67, '(^|\.)producthunt\.com$|^producthunt$', 'product hunt', 'social'),
      (68, '(^|\.)tiktok\.com$|^tiktok$', 'tiktok', 'social'),
      (69, '(^|\.)threads\.(net|com)$|^threads$', 'threads', 'social'),
      (70, '(^|\.)bsky\.app$|^bluesky$', 'bluesky', 'social'),
      (71, '(^|\.)discord(app)?\.com$|^discord$', 'discord', 'social'),
      (72, '(^|\.)github\.com$|^github$', 'github', 'social')
    ) v(ord, pattern, name, kind)
    where x.h ~ v.pattern
    order by v.ord
    limit 1
  ) m on true
  where x.h <> ''
$$;

-- A person's outside-world source from their first-touch columns. An unknown utm_source is a
-- tagged campaign; a paid medium is paid whatever the source. utm_medium=affiliate means the
-- UTMs belong to an affiliate link, so the referrer is the outside world instead.
create or replace function public.analytics_source(
  p_utm_source text,
  p_utm_medium text,
  p_referrer_host text,
  out name text,
  out kind text
)
language sql
immutable
parallel safe
set search_path = public
as $$
  with input as (
    select
      case when lower(coalesce(p_utm_medium, '')) = 'affiliate' then null else nullif(trim(p_utm_source), '') end as utm,
      lower(coalesce(p_utm_medium, '')) as medium,
      nullif(trim(p_referrer_host), '') as host
  )
  select
    case
      when i.utm is not null then (public.analytics_host_source(i.utm)).name
      when i.host is not null then (public.analytics_host_source(i.host)).name
      else 'direct'
    end,
    case
      when i.utm is not null and i.medium ~ '^(cpc|ppc|paid|paid_?social|paid_?search|display|ads?)$' then 'paid'
      when i.utm is not null then
        case (public.analytics_host_source(i.utm)).kind when 'referral' then 'campaign' else (public.analytics_host_source(i.utm)).kind end
      when i.host is not null then (public.analytics_host_source(i.host)).kind
      else 'direct'
    end
  from input i
$$;

revoke all on function public.analytics_host_source(text) from public, anon, authenticated;
revoke all on function public.analytics_source(text, text, text) from public, anon, authenticated;
grant execute on function public.analytics_host_source(text) to service_role;
grant execute on function public.analytics_source(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- The trail
-- ---------------------------------------------------------------------------

-- One row per person, both audiences (the outcome views below restrict to one).
--
-- The source comes from the person's first EVENT that carried attribution, not from the
-- first_* columns on analytics_persons. analytics_link() fills those column by column, so a
-- later visit can fill a column the first one left empty: a ChatGPT visit (utm_source only)
-- followed by an affiliate click ends up as utm_source=chatgpt.com, utm_medium=affiliate, and a
-- Google referral followed by a ?utm_source=newsletter visit ends up as "newsletter". Event rows
-- keep each visit's attribution intact, and re-resolve through merges. The person columns are
-- only the fallback for attribution that arrived without an event (the desktop bridge).
--
-- A person with no attribution and no landing page never loaded a web page -- most likely a
-- desktop install that hasn't been bridged to a browser yet -- so they're "no web visit".
create or replace view public.analytics_person_trail
with (security_invoker = on) as
with first_touch as (
  select distinct on (person_id) person_id, utm_source, utm_medium, referrer_host
  from (
    select
      e.utm_source, e.utm_medium, e.referrer_host, e.occurred_at,
      coalesce(iu.person_id, idv.person_id, ia.person_id) as person_id
    from public.analytics_events e
    left join public.analytics_identities iu  on iu.identifier  = 'user:'   || e.user_id::text
    left join public.analytics_identities idv on idv.identifier = 'device:' || e.device_id::text
    left join public.analytics_identities ia  on ia.identifier  = 'anon:'   || e.anon_id::text
    where (nullif(e.utm_source, '') is not null or nullif(e.referrer_host, '') is not null)
      and coalesce(e.props->>'ua_class', '') <> 'bot'
  ) e
  where person_id is not null
  order by person_id, occurred_at
), t as (
  select
    p.id as person_id,
    p.user_id,
    p.first_seen_at,
    case when s.kind = 'direct' and p.first_landing_path is null then 'no web visit' else s.name end as source,
    case when s.kind = 'direct' and p.first_landing_path is null then 'none' else s.kind end as source_kind,
    p.first_landing_path as landing_path,
    bt.channel as blog,
    bt.first_slug as blog_first,
    bt.cta_slug as blog_cta,
    bt.first_at as blog_at,
    a.slug as affiliate,
    p.affiliate_at
  from public.analytics_persons p
  left join first_touch ft on ft.person_id = p.id
  cross join lateral public.analytics_source(
    case when ft.person_id is not null then ft.utm_source else p.first_utm_source end,
    case when ft.person_id is not null then ft.utm_medium else p.first_utm_medium end,
    case when ft.person_id is not null then ft.referrer_host else p.first_referrer_host end
  ) s
  left join public.affiliates a on a.id = p.affiliate_id
  left join public.analytics_blog_touch bt on bt.person_id = p.id
)
select
  t.*,
  -- Source first (it's how they arrived), then the blog and the affiliate in the order they
  -- happened.
  concat_ws(' → ',
    t.source,
    case when t.blog is not null and (t.affiliate is null or t.blog_at <= t.affiliate_at) then t.blog || ' (blog)' end,
    case when t.affiliate is not null then t.affiliate || ' (affiliate)' end,
    case when t.blog is not null and t.affiliate is not null and t.blog_at > t.affiliate_at then t.blog || ' (blog)' end
  ) as journey
from t;

-- Outcomes for every layer, plus whole journeys, all time. One row per (layer, channel):
--   layer = 'source' | 'blog' | 'affiliate' | 'journey'
--   kind  = the source kind (search, ai, social, referral, campaign, paid, direct, none), or for
--           blog 'post' | 'hybrid' | 'none', for affiliate 'affiliate' | 'none'. The "(no blog)"
--           and "(no affiliate)" rows are the baseline the other rows should beat.
--   active_trials / active_subs: their subscription right now, excluding cancel-at-period-end.
create or replace view public.analytics_trail_outcomes
with (security_invoker = on) as
with base as (
  select
    t.*,
    f.visited_at, f.downloaded_at, f.installed_at, f.paired_at, f.trial_at, f.paid_at,
    sub.state,
    exists (
      select 1 from public.lifetime_purchases l
      where l.user_id = t.user_id and l.refunded_at is null
    ) as lifetime
  from public.analytics_funnel f
  join public.analytics_person_trail t on t.person_id = f.person_id
  left join lateral (
    select case
      when s.current_period_end > now() and not s.cancel_at_period_end and s.status in ('active', 'trialing')
        then s.status::text
    end as state
    from public.subscriptions s
    where s.user_id = t.user_id
    order by s.created_at desc
    limit 1
  ) sub on true
), layered as (
  select 'source' as layer, source as channel, source_kind as kind, b.* from base b
  union all
  select 'blog', coalesce(blog, '(no blog)'),
    case when blog is null then 'none' when blog_cta is not null and blog_cta <> blog_first then 'hybrid' else 'post' end,
    b.* from base b
  union all
  select 'affiliate', coalesce(affiliate, '(no affiliate)'), case when affiliate is null then 'none' else 'affiliate' end,
    b.* from base b
  union all
  select 'journey', journey, source_kind, b.* from base b
)
select
  layer,
  channel,
  kind,
  count(*) as people,
  count(*) filter (where first_seen_at >= now() - interval '30 days') as people_30d,
  count(downloaded_at) as downloaded,
  count(installed_at) as installed,
  count(paired_at) as paired,
  count(trial_at) as trials,
  count(paid_at) as paid,
  count(*) filter (where lifetime) as lifetime,
  count(*) filter (where state = 'trialing') as active_trials,
  count(*) filter (where state = 'active') as active_subs
from layered
group by 1, 2, 3;

create or replace view public.analytics_dev_trail_outcomes
with (security_invoker = on) as
with base as (
  select
    t.*,
    f.visited_at, f.downloaded_at, f.installed_at, f.paired_at, f.trial_at, f.paid_at,
    sub.state,
    exists (
      select 1 from public.lifetime_purchases l
      where l.user_id = t.user_id and l.refunded_at is null
    ) as lifetime
  from public.analytics_dev_funnel f
  join public.analytics_person_trail t on t.person_id = f.person_id
  left join lateral (
    select case
      when s.current_period_end > now() and not s.cancel_at_period_end and s.status in ('active', 'trialing')
        then s.status::text
    end as state
    from public.subscriptions s
    where s.user_id = t.user_id
    order by s.created_at desc
    limit 1
  ) sub on true
), layered as (
  select 'source' as layer, source as channel, source_kind as kind, b.* from base b
  union all
  select 'blog', coalesce(blog, '(no blog)'),
    case when blog is null then 'none' when blog_cta is not null and blog_cta <> blog_first then 'hybrid' else 'post' end,
    b.* from base b
  union all
  select 'affiliate', coalesce(affiliate, '(no affiliate)'), case when affiliate is null then 'none' else 'affiliate' end,
    b.* from base b
  union all
  select 'journey', journey, source_kind, b.* from base b
)
select
  layer,
  channel,
  kind,
  count(*) as people,
  count(*) filter (where first_seen_at >= now() - interval '30 days') as people_30d,
  count(downloaded_at) as downloaded,
  count(installed_at) as installed,
  count(paired_at) as paired,
  count(trial_at) as trials,
  count(paid_at) as paid,
  count(*) filter (where lifetime) as lifetime,
  count(*) filter (where state = 'trialing') as active_trials,
  count(*) filter (where state = 'active') as active_subs
from layered
group by 1, 2, 3;

-- 0021's 90-day single-winner funnel (affiliate > blog > source), read off the trail.
create or replace view public.analytics_channel_funnel
with (security_invoker = on) as
select
  coalesce(t.affiliate, t.blog, t.source) as channel,
  case when t.affiliate is not null then 'affiliate' when t.blog is not null then 'blog' else t.source_kind end as medium,
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
join public.analytics_person_trail t on t.person_id = f.person_id
where f.first_seen_at >= now() - interval '90 days'
group by 1, 2;

-- 0021's 90-day single-winner funnel (affiliate > blog > source), read off the trail.
create or replace view public.analytics_dev_channel_funnel
with (security_invoker = on) as
select
  coalesce(t.affiliate, t.blog, t.source) as channel,
  case when t.affiliate is not null then 'affiliate' when t.blog is not null then 'blog' else t.source_kind end as medium,
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
join public.analytics_person_trail t on t.person_id = f.person_id
where f.first_seen_at >= now() - interval '90 days'
group by 1, 2;

-- ---------------------------------------------------------------------------
-- Revenue: active excludes cancel-at-period-end
-- ---------------------------------------------------------------------------

create or replace view public.analytics_revenue_summary
with (security_invoker = on) as
with subs as (
  select s.status, s.cancel_at_period_end, s.price_id
  from public.subscriptions s
  where s.current_period_end > now()
    and s.status in ('active', 'trialing')
    and not exists (select 1 from public.analytics_ignored_users g where g.user_id = s.user_id)
      and not exists (
        select 1 from public.analytics_ignored_persons g
        join public.analytics_persons p on p.id = g.person_id
        where p.user_id = s.user_id
      )
)
select
  (select count(*) from subs where status = 'active' and not cancel_at_period_end) as active_subscriptions,
  (select count(*) from subs where status = 'trialing' and not cancel_at_period_end) as active_trials,
  count(*) filter (where event = 'trial_started') as trials_started,
  count(*) filter (where event = 'subscription_started') as subscriptions_started,
  count(*) filter (where event = 'subscription_canceled') as cancel_intents,
  count(*) filter (where event = 'subscription_ended') as subscriptions_ended,
  count(*) filter (where event = 'payment_failed') as payments_failed,
  count(*) filter (where event = 'refund_issued') as refunds,
  coalesce(sum((props->>'amount')::numeric) filter (
    where event in ('subscription_started', 'subscription_renewed')
      and props->>'amount' ~ '^[0-9]+(?:\.[0-9]+)?$'
  ), 0) as tracked_revenue,
  -- New in 0022. Still entitled, but leaving at period end.
  (select count(*) from subs where status = 'active' and cancel_at_period_end) as canceling_subscriptions,
  (select count(*) from subs where status = 'trialing' and cancel_at_period_end) as canceling_trials,
  (select count(distinct l.user_id) from public.lifetime_purchases l
    where l.refunded_at is null
      and not exists (select 1 from public.analytics_ignored_users g where g.user_id = l.user_id)
      and not exists (
        select 1 from public.analytics_ignored_persons g
        join public.analytics_persons p on p.id = g.person_id
        where p.user_id = l.user_id
      )) as lifetime_customers,
  -- Active (not canceling) paid subscriptions per Stripe price id; the app prices them into MRR.
  (select coalesce(jsonb_object_agg(price_id, n), '{}'::jsonb)
    from (select price_id, count(*) as n from subs
          where status = 'active' and not cancel_at_period_end group by 1) x) as active_by_price
from public.analytics_events_resolved;

create or replace view public.analytics_dev_revenue_summary
with (security_invoker = on) as
with subs as (
  select s.status, s.cancel_at_period_end, s.price_id
  from public.subscriptions s
  where s.current_period_end > now()
    and s.status in ('active', 'trialing')
    and (exists (select 1 from public.analytics_ignored_users g where g.user_id = s.user_id)
      or exists (
        select 1 from public.analytics_ignored_persons g
        join public.analytics_persons p on p.id = g.person_id
        where p.user_id = s.user_id
      ))
)
select
  (select count(*) from subs where status = 'active' and not cancel_at_period_end) as active_subscriptions,
  (select count(*) from subs where status = 'trialing' and not cancel_at_period_end) as active_trials,
  count(*) filter (where event = 'trial_started') as trials_started,
  count(*) filter (where event = 'subscription_started') as subscriptions_started,
  count(*) filter (where event = 'subscription_canceled') as cancel_intents,
  count(*) filter (where event = 'subscription_ended') as subscriptions_ended,
  count(*) filter (where event = 'payment_failed') as payments_failed,
  count(*) filter (where event = 'refund_issued') as refunds,
  coalesce(sum((props->>'amount')::numeric) filter (
    where event in ('subscription_started', 'subscription_renewed')
      and props->>'amount' ~ '^[0-9]+(?:\.[0-9]+)?$'
  ), 0) as tracked_revenue,
  -- New in 0022. Still entitled, but leaving at period end.
  (select count(*) from subs where status = 'active' and cancel_at_period_end) as canceling_subscriptions,
  (select count(*) from subs where status = 'trialing' and cancel_at_period_end) as canceling_trials,
  (select count(distinct l.user_id) from public.lifetime_purchases l
    where l.refunded_at is null
      and (exists (select 1 from public.analytics_ignored_users g where g.user_id = l.user_id)
      or exists (
        select 1 from public.analytics_ignored_persons g
        join public.analytics_persons p on p.id = g.person_id
        where p.user_id = l.user_id
      ))) as lifetime_customers,
  -- Active (not canceling) paid subscriptions per Stripe price id; the app prices them into MRR.
  (select coalesce(jsonb_object_agg(price_id, n), '{}'::jsonb)
    from (select price_id, count(*) as n from subs
          where status = 'active' and not cancel_at_period_end group by 1) x) as active_by_price
from public.analytics_dev_events_resolved;

revoke all on public.analytics_person_trail from anon, authenticated;
revoke all on public.analytics_trail_outcomes from anon, authenticated;
revoke all on public.analytics_dev_trail_outcomes from anon, authenticated;
revoke all on public.analytics_channel_funnel from anon, authenticated;
revoke all on public.analytics_dev_channel_funnel from anon, authenticated;
revoke all on public.analytics_revenue_summary from anon, authenticated;
revoke all on public.analytics_dev_revenue_summary from anon, authenticated;
grant select on public.analytics_person_trail to service_role;
grant select on public.analytics_trail_outcomes to service_role;
grant select on public.analytics_dev_trail_outcomes to service_role;
grant select on public.analytics_channel_funnel to service_role;
grant select on public.analytics_dev_channel_funnel to service_role;
grant select on public.analytics_revenue_summary to service_role;
grant select on public.analytics_dev_revenue_summary to service_role;
