# Affiliate Program Implementation Guide

The recommended manual-reconciliation design is automated attribution and
bookkeeping followed by manual review and payout. Do not calculate commissions
from scratch in a spreadsheet every month. Stripe webhooks should maintain an
auditable ledger that can be queried or exported before paying creators.

## 1. Program rules

Encode these rules before implementing the system:

| Rule | Initial value |
| --- | ---: |
| Attribution | Last creator click before signup |
| Cookie window | 30 days |
| Attribution lock | At signup; never overwritten afterward |
| Customer discount | 10% for 12 months |
| Creator commission | 30% of eligible revenue |
| Commission duration | First 12 months after attribution |
| Approval delay | 45 days after payment |
| Minimum payout | $50 |
| Payout cadence | Monthly |
| Eligible revenue | Amount collected after discounts, excluding tax and refunds |
| Self-referrals | Prohibited |
| Refund after payout | Negative balance against future earnings |

Use integer cents and basis points everywhere. Store 30% as `3000`, not `0.30`.

## 2. Stripe configuration

Create one Stripe coupon:

- 10% off.
- Applies only to the Talysman product.
- Repeating for 12 months, if available for the current Billing configuration.
- Named something like `Creator discount — 10% first year`.

Then create one Promotion Code per creator:

```text
MAYA10
FOCUSWITHSAM
DEVONTRACK
```

Configure each code as:

- First-time transaction only.
- Linked to the shared coupon.
- Promotion-code metadata: `affiliate_slug=maya`.
- Optional expiration or maximum redemptions.

Store Stripe's `promo_...` identifier in the database, not just the
customer-facing code. Stripe permits first-transaction restrictions and
redemption limits on Promotion Codes. See the
[Stripe promotion-code documentation](https://docs.stripe.com/payments/checkout/discounts).

The existing Checkout already exposes promotion-code entry in
[`packages/billing-server/src/index.ts`](packages/billing-server/src/index.ts).

## 3. Database model

Create `apps/web/supabase/migrations/0006_affiliates.sql`:

```sql
create type public.affiliate_partner_status as enum (
  'active', 'paused', 'terminated'
);

create type public.affiliate_referral_source as enum (
  'link', 'promotion_code', 'manual'
);

create type public.affiliate_ledger_kind as enum (
  'commission', 'refund_adjustment', 'manual_adjustment'
);

create type public.affiliate_payout_status as enum (
  'draft', 'processing', 'paid', 'failed'
);

create table public.affiliate_partners (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  display_name text not null,
  contact_email text not null,
  status public.affiliate_partner_status not null default 'active',

  stripe_promotion_code_id text unique,
  promotion_code text,

  commission_bps integer not null default 3000
    check (commission_bps between 0 and 10000),
  commission_months integer not null default 12
    check (commission_months > 0),
  cookie_days integer not null default 30
    check (cookie_days between 1 and 365),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.affiliate_referrals (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null
    references public.affiliate_partners(id),
  user_id uuid not null unique
    references public.profiles(id) on delete cascade,

  source public.affiliate_referral_source not null,
  attributed_at timestamptz not null default now(),
  commission_ends_at timestamptz not null,

  stripe_checkout_session_id text unique,
  stripe_subscription_id text unique,
  landing_path text,

  created_at timestamptz not null default now()
);

create table public.affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null
    references public.affiliate_partners(id),
  currency text not null,
  period_start date not null,
  period_end date not null,
  amount_cents integer not null default 0,
  status public.affiliate_payout_status not null default 'draft',
  external_reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.affiliate_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null
    references public.affiliate_partners(id),
  referral_id uuid not null
    references public.affiliate_referrals(id),

  kind public.affiliate_ledger_kind not null,
  source_key text not null unique,
  related_entry_id uuid
    references public.affiliate_ledger_entries(id),

  stripe_invoice_id text,
  stripe_payment_intent_id text,
  stripe_refund_id text,

  eligible_revenue_cents integer not null default 0,
  commission_bps integer not null,
  amount_cents integer not null,
  currency text not null,

  earned_at timestamptz not null,
  available_at timestamptz not null,
  payout_id uuid references public.affiliate_payouts(id),
  voided_at timestamptz,
  note text,

  created_at timestamptz not null default now()
);

create index affiliate_ledger_payable_idx
  on public.affiliate_ledger_entries
  (partner_id, currency, available_at)
  where payout_id is null and voided_at is null;

alter table public.affiliate_partners enable row level security;
alter table public.affiliate_referrals enable row level security;
alter table public.affiliate_ledger_entries enable row level security;
alter table public.affiliate_payouts enable row level security;
```

Do not add public RLS policies initially. Only the service-role backend should
access these tables.

Also update:

- `apps/web/src/lib/supabase/database.types.ts`
- `apps/web/src/lib/supabase/types.ts`

Do not store Social Security numbers, W-9 documents, or bank credentials in
these tables.

## 4. Capture creator links

Add:

```text
apps/web/src/app/r/[slug]/route.ts
```

A request to `/r/maya` should:

1. Find the active partner with slug `maya`.
2. Set an HTTP-only cookie containing the partner ID or slug.
3. Redirect to a fixed internal landing page.
4. Overwrite any earlier unclaimed creator cookie.

Cookie configuration:

```ts
response.cookies.set("talysman_affiliate", partner.id, {
  httpOnly: true,
  secure: config.app.environment === "production",
  sameSite: "lax",
  path: "/",
  maxAge: partner.cookie_days * 24 * 60 * 60,
});
```

Use a fixed redirect such as `/pricing?ref=maya`. Do not accept an unrestricted
redirect destination from the URL.

The cookie is only temporary attribution. The durable record is
`affiliate_referrals`.

## 5. Claim the referral at signup

This matters particularly for Talysman because desktop Checkout requests will
not necessarily include the browser's referral cookie.

Add:

```text
apps/web/src/lib/affiliates/claim-referral.ts
```

Its behavior should be equivalent to:

```ts
async function claimReferral(userId: string, partnerIdFromCookie: string) {
  // Validate that the partner still exists and is active.
  // Insert only if this user does not already have a referral.
  // commission_ends_at = attributed_at + partner.commission_months.
  // Never update an existing referral.
}
```

Call it from:

- Email/password signup after a session exists.
- The OAuth callback after `exchangeCodeForSession`.
- The web Checkout endpoint as a final fallback.

For email confirmation flows, the initial signup may not yet have an
authenticated user session. Claim again from the auth callback or first
authenticated Checkout.

Use the unique constraint on `user_id` plus `insert`, rather than "select then
insert." This makes competing requests safe and establishes the attribution
lock.

A creator code entered later should only establish attribution if the user has
no existing referral. It must not steal an already-attributed signup.

## 6. Attach attribution to Checkout and Stripe

Extend `createCheckoutSession` with optional attribution:

```ts
type AffiliateAttribution = {
  partnerId: string;
  referralId: string;
  promotionCodeId?: string;
};
```

Then modify the Checkout Session in
`packages/billing-server/src/index.ts`:

```ts
const metadata = {
  user_id: userId,
  ...(affiliate
    ? {
        affiliate_partner_id: affiliate.partnerId,
        affiliate_referral_id: affiliate.referralId,
      }
    : {}),
};

const session = await stripe.checkout.sessions.create({
  mode: "subscription",
  customer: customerId,
  line_items: [
    { price: priceIdForCheckoutPrice(price, config), quantity: 1 },
  ],

  ...(affiliate?.promotionCodeId
    ? {
        discounts: [
          { promotion_code: affiliate.promotionCodeId },
        ],
      }
    : {
        allow_promotion_codes: true,
      }),

  metadata,
  subscription_data: { metadata },
  client_reference_id: userId,
  success_url: ...,
  cancel_url: ...,
});
```

A Checkout Session supports only one coupon or promotion code, so automatically
applied creator discounts and a general promotion-code entry field should be
treated as alternatives.

Put the affiliate IDs in both metadata locations:

- Top-level metadata appears on `checkout.session.completed`.
- `subscription_data.metadata` appears on the Subscription and is copied onto
  future subscription invoices.

See [Stripe metadata propagation](https://docs.stripe.com/metadata/use-cases?locale=en-GB).

Never accept `partnerId` from the Checkout request body. Resolve it server-side
from the authenticated user's referral row.

## 7. Support code-only attribution

Someone may hear a code on a podcast without clicking the link.

During `checkout.session.completed`:

1. Check whether the user already has a referral.
2. If not, retrieve the Checkout Session with discounts expanded.
3. Extract the applied `promo_...` ID.
4. Find the matching active partner.
5. Insert a referral with `source='promotion_code'`.
6. Update the Stripe Subscription metadata with the new referral IDs.
7. Save the Checkout Session and Subscription IDs on the referral.

Stripe's expanded Checkout discount contains the applied Promotion Code ID. See
the [Checkout Session discount fields](https://docs.stripe.com/api/checkout/sessions/object?lang=curl).

Stripe does not guarantee webhook delivery order. This handler should also
reconcile the Checkout Session's initial invoice after creating the referral.
The unique ledger `source_key` prevents duplication if `invoice.paid` already
processed it.

## 8. Create commissions from paid invoices

Add `invoice.paid` to the event set in
`apps/web/src/app/api/stripe/webhook/route.ts`.

Stripe recommends `invoice.paid` for successful subscription invoices. See
[Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks).

For each paid invoice:

1. Ignore invoices with no real amount collected.
2. Resolve `affiliate_referral_id` from
   `invoice.subscription_details.metadata`.
3. Confirm the referral exists and is within `commission_ends_at`.
4. Calculate eligible revenue.
5. Insert one positive ledger entry.
6. Use `source_key = 'invoice:' || invoice.id`.

Suggested calculation:

```ts
const eligibleRevenue = Math.max(
  0,
  Math.min(
    invoice.amount_paid,
    invoice.total_excluding_tax ?? invoice.amount_paid,
  ),
);

const commission = Math.floor(
  (eligibleRevenue * partner.commission_bps) / 10_000,
);
```

Store `commission_bps` on the ledger entry so later changes to a creator's rate
do not rewrite historical commissions.

Set:

```text
earned_at = invoice.status_transitions.paid_at
available_at = earned_at + 45 days
```

Retrieve and store the associated PaymentIntent through Stripe's Invoice
Payment mapping. This provides a reliable way to match future refunds to the
original commission. See
[Stripe Invoice Payments](https://docs.stripe.com/api/invoice-payment).

## 9. Handle refunds as negative ledger entries

Add `refund.created` to the webhook. Continue using `charge.refunded` for the
existing customer email if desired, but do not create adjustments from both
events.

For a successful refund:

1. Find the original positive entry by `stripe_payment_intent_id`.
2. Calculate the eligible refunded revenue proportionally.
3. Insert a negative entry.
4. Use `source_key = 'refund:' || refund.id`.
5. Set `available_at` immediately.

Example:

```ts
const eligibleRefund = Math.round(
  refund.amount *
    (original.eligible_revenue_cents / originalInvoiceAmountPaid),
);

const adjustment = -Math.floor(
  (eligibleRefund * original.commission_bps) / 10_000,
);
```

If the original commission has not been paid, the adjustment reduces the
upcoming payout. If it has already been paid, the negative entry carries into
the creator's next payout.

Stripe recommends consuming refund webhook events, and a refund can be partial.
See [Stripe refund events](https://docs.stripe.com/refunds).

For the pilot, review disputes manually in Stripe before every payout. Later,
add `charge.dispute.created` and `charge.dispute.funds_reinstated` adjustments.

## 10. Monthly reconciliation procedure

Run reconciliation on the fifth business day of each month, covering the
previous calendar month.

### A. Produce payout candidates

```sql
select
  p.id as partner_id,
  p.slug,
  p.display_name,
  p.contact_email,
  l.currency,
  sum(case when l.amount_cents > 0 then l.amount_cents else 0 end)
    as gross_commission_cents,
  sum(case when l.amount_cents < 0 then l.amount_cents else 0 end)
    as adjustments_cents,
  sum(l.amount_cents) as payable_cents
from public.affiliate_ledger_entries l
join public.affiliate_partners p on p.id = l.partner_id
where l.payout_id is null
  and l.voided_at is null
  and l.available_at <= now()
group by
  p.id, p.slug, p.display_name, p.contact_email, l.currency
having sum(l.amount_cents) >= 5000
order by p.slug;
```

### B. Audit each candidate

For each creator:

- Compare positive ledger entries with paid Stripe invoices.
- Confirm the invoice customer and subscription.
- Check refunds and open disputes.
- Check for self-referrals or matching creator/customer details.
- Confirm commissions are inside the 12-month window.
- Confirm tax was excluded.
- Confirm required payout and tax documentation is on file.

Export the line-item query to CSV and retain it with the payout record.

### C. Batch approved entries

Do this transactionally:

```sql
begin;

insert into public.affiliate_payouts (
  partner_id,
  currency,
  period_start,
  period_end,
  amount_cents,
  status
)
values (
  :partner_id,
  'usd',
  :period_start,
  :period_end,
  :approved_amount,
  'processing'
)
returning id;

update public.affiliate_ledger_entries
set payout_id = :returned_payout_id
where partner_id = :partner_id
  and currency = 'usd'
  and payout_id is null
  and voided_at is null
  and available_at <= :cutoff;

commit;
```

Pay through the chosen external method. Only after the payment succeeds:

```sql
update public.affiliate_payouts
set status = 'paid',
    paid_at = now(),
    external_reference = :wise_or_ach_reference
where id = :payout_id;
```

If payment fails, return the payout to `draft` or `failed` and clear the
entries' `payout_id` before retrying.

## 11. Repair and reconciliation script

Create:

```text
apps/web/scripts/reconcile-affiliates.ts
```

It should default to dry-run and accept:

```text
--from 2026-08-01
--to 2026-08-31
--apply
```

The script should:

- List paid Stripe invoices covering the period plus a reasonable lookback.
- Filter locally by `status_transitions.paid_at`.
- Upsert missing invoice ledger entries.
- List successful refunds created during the period.
- Upsert missing refund adjustments.
- Report database entries whose Stripe objects no longer match.
- Never create payouts.

Reuse the same commission functions as the webhook. Do not implement the
calculation twice.

## 12. Required tests

Add unit tests for:

- Valid and invalid creator slugs.
- Cookie overwritten before signup.
- First claimed referral wins.
- Checkout cannot accept a forged partner ID.
- Affiliate metadata reaches both Checkout and Subscription.
- `invoice.paid` creates exactly one commission.
- Replaying the event creates no duplicate.
- A non-affiliate invoice creates no ledger entry.
- An invoice after `commission_ends_at` creates no commission.
- A partial refund creates the correct negative entry.
- A refund after payout becomes a future negative balance.
- Promotion-code-only Checkout creates a referral.
- An existing referral is not overwritten by another promotion code.
- A tax-inclusive invoice does not pay commission on tax.

Extend
`apps/web/tests/integration/stripe-webhook-cli.test.ts`
to cover `invoice.paid` and a partial refund.

## Talysman desktop limitation

Someone who clicks a creator link, downloads the app, and later creates their
account entirely inside the desktop application cannot be connected to the
browser cookie.

For the pilot, creator calls to action should lead to a web signup and discount
flow. A later version can add a referral-code field or referral deep link to the
desktop app.
