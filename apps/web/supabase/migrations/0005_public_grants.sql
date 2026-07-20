-- Table privileges for the tables created in 0001-0003.
--
-- Recent Supabase projects stopped granting `select`/DML on new public tables to
-- anon/authenticated/service_role by default, so a database created from these
-- migrations today ends up with RLS policies that can never be reached — every
-- query fails with "permission denied for table …" before RLS is consulted.
-- These grants restate the intended access explicitly. They are idempotent, so
-- they are a no-op on a project that already has them.
--
-- RLS remains the actual authorization boundary for `authenticated`; the grants
-- below only make the tables reachable.

-- Owner-readable through RLS (see 0001).
grant select on public.profiles to authenticated;
grant update on public.profiles to authenticated;
grant select on public.subscriptions to authenticated;
grant select on public.active_subscriptions to authenticated;

-- Server-side writers (webhook, billing sync, connection store) run as service_role.
grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.subscriptions to service_role;
grant select, insert, update, delete on public.connections to service_role;
grant select, insert, update, delete on public.stripe_events to service_role;
grant select on public.active_subscriptions to service_role;

-- `connections` stays unreachable from client roles: the rows hold ciphertext and
-- are only ever read through server code (see 0002).
