-- Smart filtering: per-user daily cap on LLM "judge intent" calls (POST
-- /api/desktop/judge-intent). Each call has real LLM cost, so the cap is enforced
-- server-side against a small counter table rather than trusted to the caller.
--
-- One row per (user, day); `call_count` only ever moves up within a day, so the
-- check-and-increment below is safe under concurrent requests from the same user.

create table public.smart_filter_judge_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  usage_date date not null,
  call_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

-- RLS posture follows `analytics_*` (0006): on, no policies, all access through the
-- secret-key client (supabaseAdmin). Client roles are revoked outright — this is
-- server-side bookkeeping, never something a signed-in user reads or writes directly.
alter table public.smart_filter_judge_usage enable row level security;
revoke all on public.smart_filter_judge_usage from authenticated, anon;
grant select, insert, update on public.smart_filter_judge_usage to service_role;

-- Atomically checks the caller's usage for `p_date` against `p_limit` and increments
-- it in the same statement, so two concurrent requests from the same user can't both
-- read "499" and both proceed past a 500 cap. Returns true (and increments) if the
-- call is allowed; false (no increment) if the cap has already been reached.
create or replace function public.smart_filter_check_and_increment_judge_usage(
  p_user_id uuid,
  p_date date,
  p_limit integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.smart_filter_judge_usage (user_id, usage_date, call_count)
  values (p_user_id, p_date, 0)
  on conflict (user_id, usage_date) do nothing;

  update public.smart_filter_judge_usage
  set call_count = call_count + 1,
      updated_at = now()
  where user_id = p_user_id
    and usage_date = p_date
    and call_count < p_limit
  returning call_count into v_count;

  return v_count is not null;
end;
$$;

revoke all on function public.smart_filter_check_and_increment_judge_usage(uuid, date, integer)
  from public, anon, authenticated;
grant execute on function public.smart_filter_check_and_increment_judge_usage(uuid, date, integer)
  to service_role;
