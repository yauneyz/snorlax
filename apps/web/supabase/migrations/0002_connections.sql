-- Connections: encrypted third-party credentials. Today: GSC only.
-- Token plaintext (refresh + access tokens) is encrypted with AES-256-GCM
-- before storage; the key lives in env (TOKEN_ENCRYPTION_KEY) and never
-- touches the database. The kind enum is extensible — Bing/Google Ads/etc.
-- get added in later migrations.

create type public.connection_kind as enum ('gsc');

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind public.connection_kind not null,
  label text,                                  -- the connected Google account email
  ciphertext bytea not null,
  iv bytea not null,
  tag bytea not null,
  meta jsonb not null default '{}'::jsonb,     -- non-secret hints (e.g. last selected siteUrl, status)
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, label)
);

create index connections_user_kind_idx on public.connections(user_id, kind);

-- No client access. All reads/writes go through server code via the secret-key
-- client (supabaseAdmin), which manually scopes by user_id. This matches the
-- wrapper convention used by `subscriptions` (server-only writer); we
-- additionally lock down reads here because the row carries ciphertext.
alter table public.connections enable row level security;
revoke all on public.connections from authenticated;
revoke all on public.connections from anon;

create trigger connections_updated_at
  before update on public.connections
  for each row execute procedure public.set_updated_at();
