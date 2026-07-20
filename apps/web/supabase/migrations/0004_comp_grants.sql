-- Complimentary ("comped") Pro accounts: friends, family, beta testers.
--
-- A comp is not a payment, so it is not modeled as a Stripe subscription: a
-- 100%-off forever coupon would still be a recurring subscription that has to
-- keep renewing, and Stripe's analytics count a $0 subscriber as churned.
-- Instead a grant lives here, written only by the service role, and the
-- `active_entitlements` view unions it with the Stripe projection so every
-- existing "is this user entitled?" read site keeps working unchanged.
--
-- Two ways to issue one:
--   1. retroactively, by user id      → `pnpm comp:grant <email>`
--   2. a single-use code you email    → `pnpm comp:code`, redeemed at /redeem/<code>

create table public.comp_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,               -- sha256 of the normalized code; plaintext is never stored
  note text,                                    -- who it was minted for, e.g. "mom"
  max_redemptions int not null default 1 check (max_redemptions > 0),
  redemption_count int not null default 0 check (redemption_count >= 0),
  expires_at timestamptz,                       -- null = the code never goes stale
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.entitlement_grants (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  plan text not null default 'pro',
  note text,
  source text not null check (source in ('manual', 'code')),
  code_id uuid references public.comp_codes(id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,                       -- null = lifetime
  revoked_at timestamptz
);

create index entitlement_grants_active_idx on public.entitlement_grants(user_id)
  where revoked_at is null;

-- The single read used for entitlement everywhere: middleware, requireSubscribed,
-- the account page, and getUserEntitlement. Column shape is deliberately narrow
-- (user_id/source/status/current_period_end) so both branches can union.
-- `security_invoker` makes the view honor the caller's RLS instead of running as
-- its owner, so a signed-in user can only ever see their own row through it.
create or replace view public.active_entitlements
with (security_invoker = true) as
  select
    user_id,
    'subscription'::text as source,
    status::text as status,
    current_period_end
  -- Reads `subscriptions` directly rather than the `active_subscriptions` view:
  -- a nested view would be evaluated as its own owner and bypass RLS, defeating
  -- the security_invoker above. The predicate is the one that view uses.
  from public.subscriptions
  where status in ('trialing', 'active')
    and current_period_end > now()
  union all
  select
    user_id,
    'grant'::text as source,
    'comped'::text as status,
    expires_at as current_period_end
  from public.entitlement_grants
  where revoked_at is null
    and (expires_at is null or expires_at > now());

-- RLS mirrors `subscriptions` (0001_init.sql): the owner may read their own
-- grant so the anon-key clients in middleware/RSC can see it; nobody but the
-- service role writes. `comp_codes` gets no policy at all — an unredeemed code
-- is a secret, and only server code may look at it.
alter table public.entitlement_grants enable row level security;
alter table public.comp_codes enable row level security;
revoke all on public.comp_codes from authenticated;
revoke all on public.comp_codes from anon;

create policy "entitlement_grants: owner read" on public.entitlement_grants
  for select using (auth.uid() = user_id);
-- No insert/update/delete policies: only the service role grants and revokes.

-- Table privileges are granted explicitly: recent Supabase projects no longer
-- hand `select` to anon/authenticated by default, so RLS alone isn't enough to
-- make a table readable.
grant select on public.entitlement_grants to authenticated;
grant select, insert, update, delete on public.entitlement_grants to service_role;
grant select, insert, update, delete on public.comp_codes to service_role;
grant select on public.active_entitlements to authenticated, service_role;

-- Redemption runs entirely in the database so that concurrent attempts on the
-- same code cannot both succeed: the code row is locked for the duration.
-- Returns one of: ok | not_found | revoked | expired | exhausted | already_comped
create function public.redeem_comp_code(p_code_hash text, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.comp_codes%rowtype;
begin
  select * into v_code
  from public.comp_codes
  where code_hash = p_code_hash
  for update;

  if not found then
    return 'not_found';
  end if;
  if v_code.revoked_at is not null then
    return 'revoked';
  end if;
  if v_code.expires_at is not null and v_code.expires_at <= now() then
    return 'expired';
  end if;

  -- Already comped: don't burn a redemption, just report success-ish.
  if exists (
    select 1 from public.entitlement_grants
    where user_id = p_user_id
      and revoked_at is null
      and (expires_at is null or expires_at > now())
  ) then
    return 'already_comped';
  end if;

  if v_code.redemption_count >= v_code.max_redemptions then
    return 'exhausted';
  end if;

  insert into public.entitlement_grants (user_id, plan, note, source, code_id)
  values (p_user_id, 'pro', v_code.note, 'code', v_code.id)
  on conflict (user_id) do update
    set plan = 'pro',
        note = coalesce(public.entitlement_grants.note, excluded.note),
        source = 'code',
        code_id = excluded.code_id,
        granted_at = now(),
        expires_at = null,
        revoked_at = null;

  update public.comp_codes
  set redemption_count = redemption_count + 1
  where id = v_code.id;

  return 'ok';
end;
$$;

-- Callable by a signed-in user (the route also gates on requireUser); the
-- function itself is the authorization boundary — it only ever grants to the
-- user id it is handed, and the route hands it the session's own id.
revoke all on function public.redeem_comp_code(text, uuid) from public;
grant execute on function public.redeem_comp_code(text, uuid) to service_role;
