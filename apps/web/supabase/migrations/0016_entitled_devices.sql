-- Computers using a Pro account. Pro (subscription, comp, or lifetime) covers a handful of
-- computers at once, so one account can't quietly become a whole friend group's license.
-- Free has no limit and never registers here.
--
-- A device holds a slot while it keeps checking in; one that hasn't for the stale window drops
-- out of the count on its own, and the owner can remove one from the account page to free its
-- slot sooner. Rows are written only by claim_entitled_device, through the service role.
create table public.entitled_devices (
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id text not null check (char_length(device_id) between 1 and 128),
  name text check (char_length(name) <= 200),
  platform text check (char_length(platform) <= 32),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

alter table public.entitled_devices enable row level security;
create policy "entitled_devices: owner read" on public.entitled_devices
  for select using (auth.uid() = user_id);
create policy "entitled_devices: owner delete" on public.entitled_devices
  for delete using (auth.uid() = user_id);
grant select, delete on public.entitled_devices to authenticated;
grant select, insert, update, delete on public.entitled_devices to service_role;

-- Registers or refreshes a device and returns whether it may use Pro. A known device always
-- may (and has its last_seen_at bumped); a new one only while fewer than p_limit devices have
-- been seen within p_stale_after. The per-user advisory lock serialises concurrent claims so
-- two new computers checking in at once can't both take the last slot.
create function public.claim_entitled_device(
  p_user_id uuid,
  p_device_id text,
  p_name text,
  p_platform text,
  p_limit integer,
  p_stale_after interval
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('entitled_devices:' || p_user_id::text, 0));

  update public.entitled_devices
  set last_seen_at = now(),
      name = coalesce(p_name, name),
      platform = coalesce(p_platform, platform)
  where user_id = p_user_id and device_id = p_device_id;
  if found then
    return true;
  end if;

  select count(*) into v_active
  from public.entitled_devices
  where user_id = p_user_id and last_seen_at > now() - p_stale_after;
  if v_active >= p_limit then
    return false;
  end if;

  -- A stale row for this user is dead weight now that a new device is taking a slot.
  delete from public.entitled_devices
  where user_id = p_user_id and last_seen_at <= now() - p_stale_after;

  insert into public.entitled_devices (user_id, device_id, name, platform)
  values (p_user_id, p_device_id, p_name, p_platform);
  return true;
end;
$$;

revoke all on function public.claim_entitled_device(uuid, text, text, text, integer, interval) from public;
grant execute on function public.claim_entitled_device(uuid, text, text, text, integer, interval) to service_role;
