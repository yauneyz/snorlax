-- Messages we push into the desktop app: a banner while it runs, and the startup-failure dialog
-- when it can't. Targeted by device so anonymous installs (no account, no email) are still
-- reachable; the desktop fetches these straight from the web API, never through the daemon, so
-- they arrive even when the daemon is the thing that's broken.
--
-- Same posture as insights_push_devices: RLS on, no policies, service role only. Reads go through
-- /api/desktop/messages; writes come from scripts/send-app-message.mjs.
create table public.app_messages (
  id uuid primary key default gen_random_uuid(),
  -- Exactly one audience: one device, one account (all its devices), or everyone.
  device_id uuid,
  user_id uuid references auth.users(id) on delete cascade,
  broadcast boolean not null default false,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 2000),
  link_url text check (link_url is null or link_url ~ '^(https://|mailto:)'),
  link_label text check (link_label is null or char_length(link_label) between 1 and 40),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  check (num_nonnulls(device_id, user_id) + broadcast::int = 1)
);

create index app_messages_device_idx on public.app_messages(device_id) where device_id is not null;
create index app_messages_user_idx on public.app_messages(user_id) where user_id is not null;

-- Per-device delivery state, so we can tell whether a message actually reached someone.
create table public.app_message_receipts (
  message_id uuid not null references public.app_messages(id) on delete cascade,
  device_id uuid not null,
  seen_at timestamptz not null default now(),
  dismissed_at timestamptz,
  primary key (message_id, device_id)
);

alter table public.app_messages enable row level security;
alter table public.app_message_receipts enable row level security;

grant select, insert, update, delete on public.app_messages to service_role;
grant select, insert, update, delete on public.app_message_receipts to service_role;
