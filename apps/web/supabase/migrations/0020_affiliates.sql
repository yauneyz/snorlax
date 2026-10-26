-- Affiliate links: informal attribution and payout bookkeeping.
--
-- An affiliate link is https://www.talysman.app/r/<slug>. The route redirects to the
-- affiliate's landing path with `utm_source=<slug>&utm_medium=affiliate`, so the landing
-- page_viewed carries it through the normal ingest path and analytics_link() below stamps the
-- affiliate onto the person. No new event, no new ingest route.
--
-- Attribution rules:
--   * First affiliate wins. A person who clicks Maya's link and later Sam's stays Maya's, so
--     one affiliate can never take another's referral.
--   * The affiliate beats first-touch for channel reporting. Someone who found us on Google
--     and then signed up through Maya's link is filed under "maya / affiliate" in the Channels
--     panel, so the channel shows exactly the people the affiliate would be paid for.
--   * Identity merges keep the earliest affiliate across every merged person.
--
-- Management lives in the local-only `pnpm affiliates` app (apps/web/scripts/affiliates/),
-- which writes with the secret key. RLS is on with no policies; nothing in the deployed app
-- can write these tables, and the /r route only reads through service_role.

create table public.affiliates (
  id uuid primary key default gen_random_uuid(),
  -- Immutable once created: it is what the link and the utm_source on old events carry.
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name text not null check (length(trim(name)) > 0),
  contact text,
  notes text,
  active boolean not null default true,
  -- Where /r/<slug> lands. Internal paths only; checked again by the route.
  landing_path text not null default '/' check (landing_path ~ '^/([^/]|$)'),
  -- Basis points: 5000 = 50%.
  commission_bps integer not null default 5000 check (commission_bps between 0 and 10000),
  -- Commission accrues on charges within this many months of the referral's first payment.
  commission_months integer not null default 12 check (commission_months between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- What has actually been sent to each affiliate. Owed = commission earned - sum(paid here).
create table public.affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  paid_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);
create index affiliate_payouts_affiliate_idx on public.affiliate_payouts(affiliate_id);

alter table public.affiliates enable row level security;
alter table public.affiliate_payouts enable row level security;
revoke all on public.affiliates from anon, authenticated;
revoke all on public.affiliate_payouts from anon, authenticated;
grant select, insert, update, delete on public.affiliates to service_role;
grant select, insert, update, delete on public.affiliate_payouts to service_role;

alter table public.analytics_persons
  add column affiliate_id uuid references public.affiliates(id) on delete set null,
  add column affiliate_at timestamptz;
create index analytics_persons_affiliate_idx on public.analytics_persons(affiliate_id)
  where affiliate_id is not null;

-- analytics_link(): 0019's body plus affiliate stamping and merge carry-over. Everything not
-- marked AFFILIATE is unchanged from 0019.
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
  v_user uuid;
  v_person uuid;
  v_person_user uuid;
  v_found uuid[];
  v_losers uuid[];
  v_affiliate uuid;
begin
  -- Serialize the whole function; see 0006 for why.
  perform pg_advisory_xact_lock(hashtext('analytics_link'));

  select substring(i.identifier from 6)::uuid into v_user
  from unnest(p_identifiers) i(identifier)
  where i.identifier like 'user:%'
  limit 1;

  -- AFFILIATE: only a known, active slug counts. A hand-typed utm_medium=affiliate with an
  -- unknown source stays an ordinary UTM channel.
  if lower(coalesce(p_attribution->>'utm_medium', '')) = 'affiliate' then
    select id into v_affiliate
    from public.affiliates
    where slug = lower(p_attribution->>'utm_source') and active;
  end if;

  select array_agg(distinct person_id) into v_found
  from public.analytics_identities
  where identifier = any(p_identifiers);

  if v_found is null or array_length(v_found, 1) = 0 then
    insert into public.analytics_persons default values returning id into v_person;
  else
    -- The person already carrying this call's account wins outright, so an older anonymous
    -- person folds into it rather than trying to take its user_id. Otherwise oldest wins.
    select id, user_id into v_person, v_person_user
    from public.analytics_persons
    where id = any(v_found)
    order by coalesce(user_id = v_user, false) desc, first_seen_at asc, id asc
    limit 1;

    -- Only fold in persons that are not already a DIFFERENT known account. Two persons
    -- carrying distinct non-null user_ids are two humans -- most likely two people sharing
    -- a browser or a machine -- and welding them together would be unrecoverable, since the
    -- events keep no person_id to un-merge. Leave those rows and their edges alone; the
    -- identifier insert below is `do nothing`, so their existing mappings survive.
    select array_agg(id) into v_losers
    from public.analytics_persons
    where id = any(v_found)
      and id <> v_person
      and (user_id is null or user_id is not distinct from v_person_user);

    if v_losers is not null and array_length(v_losers, 1) > 0 then
      update public.analytics_identities
        set person_id = v_person
        where person_id = any(v_losers);
      -- Carry the earliest first-touch forward, then drop the merged-away rows. The winner is
      -- no longer always the oldest, so first-touch prefers whichever row was seen first.
      update public.analytics_persons w set
        first_seen_at       = least(w.first_seen_at, l.first_seen_at),
        first_utm_source    = case when l.first_seen_at < w.first_seen_at then coalesce(l.first_utm_source,    w.first_utm_source)    else coalesce(w.first_utm_source,    l.first_utm_source)    end,
        first_utm_medium    = case when l.first_seen_at < w.first_seen_at then coalesce(l.first_utm_medium,    w.first_utm_medium)    else coalesce(w.first_utm_medium,    l.first_utm_medium)    end,
        first_utm_campaign  = case when l.first_seen_at < w.first_seen_at then coalesce(l.first_utm_campaign,  w.first_utm_campaign)  else coalesce(w.first_utm_campaign,  l.first_utm_campaign)  end,
        first_referrer_host = case when l.first_seen_at < w.first_seen_at then coalesce(l.first_referrer_host, w.first_referrer_host) else coalesce(w.first_referrer_host, l.first_referrer_host) end,
        first_landing_path  = case when l.first_seen_at < w.first_seen_at then coalesce(l.first_landing_path,  w.first_landing_path)  else coalesce(w.first_landing_path,  l.first_landing_path)  end,
        first_country       = case when l.first_seen_at < w.first_seen_at then coalesce(l.first_country,       w.first_country)       else coalesce(w.first_country,       l.first_country)       end
      from (
        select * from public.analytics_persons
        where id = any(v_losers)
        order by first_seen_at asc limit 1
      ) l
      where w.id = v_person;

      -- AFFILIATE: the earliest affiliate across ALL merged persons wins, not just the oldest
      -- loser's -- any of them may be the one that clicked the link.
      update public.analytics_persons w set
        affiliate_id = l.affiliate_id,
        affiliate_at = l.affiliate_at
      from (
        select affiliate_id, affiliate_at from public.analytics_persons
        where id = any(v_losers) and affiliate_id is not null
        order by affiliate_at asc limit 1
      ) l
      where w.id = v_person
        and (w.affiliate_id is null or l.affiliate_at < w.affiliate_at);

      delete from public.analytics_persons where id = any(v_losers);
    end if;
  end if;

  insert into public.analytics_identities (identifier, person_id)
  select unnest(p_identifiers), v_person
  on conflict (identifier) do nothing;

  -- Promote user_id onto the person when we learn it -- unless another person already holds it
  -- (only possible if its user: edge points elsewhere), which must not fail the whole call.
  update public.analytics_persons p
     set user_id = v_user
   where p.id = v_person
     and v_user is not null
     and p.user_id is null
     and not exists (select 1 from public.analytics_persons o where o.user_id = v_user);

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
    last_utm_campaign   = coalesce(nullif(p_attribution->>'utm_campaign', ''), p.last_utm_campaign),
    -- AFFILIATE: first affiliate wins, like first-touch.
    affiliate_at        = case when p.affiliate_id is null and v_affiliate is not null then now() else p.affiliate_at end,
    affiliate_id        = coalesce(p.affiliate_id, v_affiliate)
  where p.id = v_person;

  return v_person;
end;
$$;

revoke all on function public.analytics_link(text[], jsonb) from public, anon, authenticated;

-- Channel funnels: 0012's expressions with the affiliate taking precedence. channelOf() in
-- src/server/analytics/channel.ts mirrors this and must stay in step.
create or replace view public.analytics_channel_funnel
with (security_invoker = on) as
select
  coalesce(
    a.slug,
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
  case when a.slug is not null then 'affiliate' else coalesce(
    f.first_utm_medium,
    case
      when f.first_referrer_host ~* '(^|\.)(google\.|bing\.com$|duckduckgo\.com$|yahoo\.)' then 'organic'
      when f.first_referrer_host is not null then 'referral'
      else 'none'
    end
  ) end as medium,
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
where f.first_seen_at >= now() - interval '90 days'
group by 1, 2;

create or replace view public.analytics_dev_channel_funnel
with (security_invoker = on) as
select
  coalesce(
    a.slug,
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
  case when a.slug is not null then 'affiliate' else coalesce(
    f.first_utm_medium,
    case
      when f.first_referrer_host ~* '(^|\.)(google\.|bing\.com$|duckduckgo\.com$|yahoo\.)' then 'organic'
      when f.first_referrer_host is not null then 'referral'
      else 'none'
    end
  ) end as medium,
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
where f.first_seen_at >= now() - interval '90 days'
group by 1, 2;

-- Every person an affiliate earned, all time (the channel views are 90-day). Ignored/internal
-- persons drop out through analytics_funnel, which also rules out self-referral by the
-- operator. Lifetime purchases never emit subscription_started, so `paid_at` alone misses
-- them; `lifetime_purchased_at` covers that path. Payout amounts come from Stripe charges in
-- the admin app, keyed by stripe_customer_id.
create or replace view public.affiliate_referrals
with (security_invoker = on) as
select
  p.affiliate_id,
  a.slug as affiliate_slug,
  p.id as person_id,
  p.affiliate_at,
  p.first_seen_at,
  p.user_id,
  pr.email,
  pr.stripe_customer_id,
  f.downloaded_at,
  f.installed_at,
  f.signed_up_at,
  f.paired_at,
  f.trial_at,
  f.paid_at,
  (
    select min(lp.purchased_at) from public.lifetime_purchases lp
    where lp.user_id = p.user_id and lp.refunded_at is null
  ) as lifetime_purchased_at,
  (
    select s.status::text from public.subscriptions s
    where s.user_id = p.user_id
    order by s.created_at desc limit 1
  ) as subscription_status
from public.analytics_persons p
join public.affiliates a on a.id = p.affiliate_id
join public.analytics_funnel f on f.person_id = p.id
left join public.profiles pr on pr.id = p.user_id;

revoke all on public.analytics_channel_funnel from anon, authenticated;
revoke all on public.analytics_dev_channel_funnel from anon, authenticated;
revoke all on public.affiliate_referrals from anon, authenticated;
grant select on public.analytics_channel_funnel to service_role;
grant select on public.analytics_dev_channel_funnel to service_role;
grant select on public.affiliate_referrals to service_role;
