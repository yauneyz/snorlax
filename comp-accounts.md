# Complimentary (comped) Pro accounts

How to give someone lifetime Pro for free — friends, family, beta testers — and how to take
it back. Companion to [`payments-arch.md`](./payments-arch.md), which covers paid billing.

---

## 1. Why this isn't a Stripe discount

A comp isn't a payment, so it isn't modeled as one. The obvious Stripe route — a 100%-off
`duration: forever` coupon — would create a real subscription that has to keep renewing for
life, Stripe's analytics count a $0 subscriber as *churned*, and the subscription list fills
with fake billing cycles. Worse, "lifetime" has no Stripe primitive at all.

Instead a comp is a row in `entitlement_grants`, written only by the service role. Stripe
never hears about it. The `active_entitlements` view unions grants with live subscriptions,
so every "is this user entitled?" read — middleware, `requireSubscribed`, the account page,
`getUserEntitlement` — answers correctly without knowing which kind it found.

---

## 2. Issuing a comp

Everything runs from `apps/web` through one script. It needs `SUPABASE_SECRET_KEY`, which
`pnpm sync:env` writes into `apps/web/.env.local`.

```bash
cd apps/web        # or use `pnpm comp …` from the repo root
```

### They already have an account → grant it directly

```bash
pnpm comp grant zac.friend@example.com --note "mom"
```

Takes effect within the 5-minute entitlement TTL; nothing for them to do. Fails with a
pointer to `comp code` if that email has never signed up.

### They don't have an account yet → send a code

```bash
pnpm comp code --note "mom"

  TLY-4K2P-9XQR

  https://talysman.app/redeem/TLY-4K2P-9XQR

  Single use · mom. Only the hash is stored — copy it now, it can't be shown again.
```

Email them the link. Signed-out visitors get routed through login/signup and land back on
the code, so it works for someone who has never heard of the app. Redemption is always an
explicit click, so a link scanner or mail-client prefetch can't burn the code.

If they already have the desktop app, they can instead open **Account → Redeem a code** and
paste the bare code. Same endpoint, same result. The link stays a plain text link until
clicked and folds away when they leave the tab — nobody who wasn't sent a code will notice
it.

### Flags

| Flag | Applies to | Effect |
| --- | --- | --- |
| `--note "…"` | `grant`, `code` | Who it's for. Shows up in `pnpm comp list`. |
| `--expires 2027-01-01` | `grant`, `code` | On a grant: Pro ends then. On a code: the *code* goes stale then (the grant it creates is still lifetime). |
| `--uses N` | `code` | Multi-use code, capped at N redemptions. Default 1. |
| `--prod` | all writes | Required to write to a hosted Supabase project. Without it the script refuses anything that isn't localhost. |

### Seeing what's out there

```bash
pnpm comp list
```

Lists grants (email, lifetime/expiry/revoked, source, note) and codes (date, open/used/
revoked, redemption count, note). Code plaintext is never shown — only its hash is stored,
so a lost code gets re-issued, never recovered.

---

## 3. Taking it back

```bash
pnpm comp revoke zac.friend@example.com
```

Sets `revoked_at` on the grant **and** on the code that created it, so an old email can't
simply re-grant it. The account drops to Free within the entitlement TTL (up to 5 minutes on
web; the desktop app picks it up on its next refresh, or immediately on restart).

Note the desktop app's 30-day offline lease: a comped user who is offline keeps their last
verified entitlement until they reconnect. Revocation is not instant for someone who never
comes back online.

---

## 4. What a comped account sees

| Surface | Behavior |
| --- | --- |
| Web `/account` | Plan reads **Pro (complimentary)**. No renewal date, no *Manage billing* button. |
| Desktop Account | Plan badge **Pro**, with `· complimentary` beside it. No *Manage billing*. |
| Desktop Plans | Pro marked *current*; upgrade buttons disabled. |
| Everything gated | Identical to a paying Pro user — same limits, same features. |

The billing-portal button is hidden deliberately: a comped account has no Stripe customer,
so opening the portal would throw `NoStripeCustomerError`.

Under the hood the entitlement carries `status: "comped"`, which is what those surfaces key
off. A comped user who later subscribes for real keeps both rows; the paid subscription wins
for display so renewal state stays visible.

---

## 5. Where the pieces live

| Concern | File |
| --- | --- |
| Schema, view, redemption function | `apps/web/supabase/migrations/0004_comp_grants.sql` |
| Table privileges for the 0001–0003 tables | `apps/web/supabase/migrations/0005_public_grants.sql` |
| Code generation / normalization / hashing | `apps/web/src/lib/comp/code.ts` |
| Redemption + rate limiting | `apps/web/src/lib/comp/redeem.ts` |
| HTTP: web (cookie) / desktop (bearer) | `apps/web/src/app/api/comp/redeem/route.ts`, `apps/web/src/app/api/desktop/comp/redeem/route.ts` |
| Unlisted redeem page | `apps/web/src/app/(auth)/redeem/{page.tsx,[code]/page.tsx}` |
| Entitlement readers | `packages/billing-server/src/index.ts` (`getUserEntitlement`, `getSubscriptionDetail`, `hasActiveCompGrant`) |
| Desktop redeem path | `apps/desktop/src/main/auth/billing.ts` → IPC `app:redeemCode` → `renderer/pages/Account.tsx` |
| Admin CLI | `apps/web/scripts/comp.ts` |

### Security properties worth preserving

- **No admin UI, no privileged endpoint.** Grants are written out-of-band with the secret
  key, so the shipped app has no backdoor to defend. Keep it that way.
- **Codes are secrets.** Only `sha256(normalized_code)` is stored. `comp_codes` has RLS on
  and *no* policy, so it is unreachable by any client role.
- **Redemption is atomic.** `redeem_comp_code()` locks the code row, so two people racing a
  single-use code cannot both win. Don't reimplement this check in JS.
- **Failures are indistinguishable.** Unknown, revoked, expired, and exhausted codes all
  return "That code isn't valid." — otherwise the endpoint becomes a code oracle. Attempts
  are rate-limited per user and per IP (5 per 10 minutes, per server instance).
- **The view honors RLS.** `active_entitlements` is `security_invoker`, and it reads
  `subscriptions` directly rather than nesting `active_subscriptions` (a nested view would
  run as its owner and bypass RLS).

---

## 6. Going live

Done as of 2026-07-21 — migrations `0001`–`0005` are applied to the hosted project
(`lkanoehzgogtrxzycutl`) and comps work in production. This section is kept for the next time
a migration needs to reach prod.

Never assume the hosted project's schema state; ask it:

```bash
supabase migration list --linked --workdir apps/web
```

An earlier version of this section claimed only `0004`/`0005` needed pushing. That was wrong —
the hosted project had Auth running but a completely empty `public` schema, so *every*
migration was outstanding and nothing that touches a table worked in prod. Check first.

```bash
supabase db push --linked --dry-run --workdir apps/web   # confirm the list
supabase db push --linked --workdir apps/web
```

`0005` restates table privileges for the pre-existing tables. Recent Supabase projects stopped
granting `select`/DML on new public tables by default, which leaves RLS policies unreachable —
locally, every table returned `permission denied` before this migration. It's idempotent, so
it's a no-op if the hosted project already has the grants.

Then issue against production. `pnpm comp` targets whatever `.env.local` points at, so switch
it to prod credentials first and switch back afterward:

```bash
pnpm --filter @talysman/web sync:env --mode=prod
pnpm comp code --note "mom" --prod
pnpm --filter @talysman/web sync:env          # restore dev/localhost
```

---

## 7. Verifying after a change

```bash
supabase migration up --workdir apps/web   # apply 0004/0005 locally
pnpm --filter @talysman/web test           # unit tests, incl. tests/unit/comp-entitlement.test.ts
pnpm comp code --note smoke                # mint, then redeem at http://localhost:3000/redeem/<code>
pnpm comp list                             # confirm the grant landed and the code burned
pnpm comp revoke <email>                   # confirm the account drops to Free
```

The redemption function's own outcomes (`ok`, `already_comped`, `exhausted`, `not_found`,
`expired`, `revoked`) are worth exercising directly against the database if you touch the SQL.
