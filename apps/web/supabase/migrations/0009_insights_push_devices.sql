-- FCM registrations for the private Android insights companion app. The public roles get no
-- policies and no grants: registration is available only through the bearer-token-protected
-- route, and delivery uses the server's service-role client.
create table public.insights_push_devices (
  token text primary key check (char_length(token) between 20 and 4096),
  platform text not null default 'android' check (platform = 'android'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.insights_push_devices enable row level security;

grant select, insert, update, delete on public.insights_push_devices to service_role;
