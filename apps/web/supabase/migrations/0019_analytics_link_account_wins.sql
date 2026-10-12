-- analytics_link(): fix `duplicate key value violates unique constraint
-- "analytics_persons_user_id_key"` at the user_id promotion.
--
-- 0006 picked the oldest found person as the merge winner and claimed that "a mergeable loser
-- always has user_id is null and the promotion cannot collide". That missed one shape: an
-- account's person is created FIRST from a user-only identifier set (e.g. the server-side
-- checkout_started/trial_started events), and only later does a call arrive carrying
-- device:/anon: + user: for an anonymous person that is OLDER. The anonymous person wins on
-- age, the account's person is not a mergeable loser (it has a user_id the winner lacks), and
-- the promotion then tries to give the winner a user_id the account's person already holds.
-- Every call for that device+account fails from then on, and track()/reportActiveDay()/
-- reportUsage() throw before writing, so all of that account's events are dropped.
--
-- Fix: when the identifiers name an account and that account's person was found, it wins; the
-- older anonymous persons fold into it, and first-touch attribution still comes from whichever
-- row was seen first. The promotion is also guarded, so a user_id held by a person outside the
-- found set skips the promotion instead of failing the whole call.
--
-- Persons already stuck in this state need no backfill: the next analytics_link() call for
-- them merges the anonymous person into the account's person.
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
begin
  -- Serialize the whole function; see 0006 for why.
  perform pg_advisory_xact_lock(hashtext('analytics_link'));

  select substring(i.identifier from 6)::uuid into v_user
  from unnest(p_identifiers) i(identifier)
  where i.identifier like 'user:%'
  limit 1;

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
    last_utm_campaign   = coalesce(nullif(p_attribution->>'utm_campaign', ''), p.last_utm_campaign)
  where p.id = v_person;

  return v_person;
end;
$$;
