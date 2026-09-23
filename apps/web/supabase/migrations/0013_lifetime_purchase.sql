-- A one-time $149 Stripe Checkout purchase (mode=payment, not a subscription) grants Pro
-- forever. Modeled as an entitlement_grants row exactly like a comp (see 0004_comp_grants.sql):
-- plan='pro', expires_at=null, but with its own `source` value so it's distinguishable from a
-- manually-issued comp in reporting.

alter table public.entitlement_grants drop constraint entitlement_grants_source_check;
alter table public.entitlement_grants add constraint entitlement_grants_source_check
  check (source in ('manual', 'code', 'lifetime_purchase'));
