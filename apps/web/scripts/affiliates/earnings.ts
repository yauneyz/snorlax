/**
 * Commission math for the affiliates app. Pure, so it is unit-tested without Stripe.
 *
 * Rules (per affiliate, editable in the app):
 *   * Only succeeded charges made at or after the moment the person clicked the link count.
 *   * The commission window opens at the referral's first such charge and lasts
 *     `commission_months`. Renewals inside it count; later ones don't.
 *   * Eligible revenue is net of refunds (`amount - amount_refunded`). Talysman doesn't collect
 *     tax through Stripe, so a charge's amount is revenue.
 *   * Commission is `floor(eligible * bps / 10000)` per currency.
 */

export type ChargeLike = {
  id: string;
  /** Unix seconds, as Stripe returns it. */
  created: number;
  amount: number;
  amount_refunded: number;
  currency: string;
  status: string;
};

export type CurrencyCents = Record<string, number>;

export type ReferralEarnings = {
  firstPaidAt: string | null;
  windowEndsAt: string | null;
  /** Net revenue inside the window, by currency. */
  eligible: CurrencyCents;
  /** Net revenue outside it (before the click or after the window), by currency. */
  ineligible: CurrencyCents;
  commission: CurrencyCents;
  chargeCount: number;
};

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  // Clamp Jan 31 + 1 month to Feb 28/29 instead of rolling into March.
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

function add(into: CurrencyCents, currency: string, cents: number) {
  into[currency] = (into[currency] ?? 0) + cents;
}

export function referralEarnings(
  charges: ChargeLike[],
  terms: { attributedAt: string; commissionBps: number; commissionMonths: number },
): ReferralEarnings {
  const attributedMs = new Date(terms.attributedAt).getTime();
  const succeeded = charges
    .filter((charge) => charge.status === "succeeded")
    .sort((a, b) => a.created - b.created);
  const first = succeeded.find((charge) => charge.created * 1000 >= attributedMs);
  const windowStart = first ? new Date(first.created * 1000) : null;
  const windowEnd = windowStart ? addMonths(windowStart, terms.commissionMonths) : null;

  const eligible: CurrencyCents = {};
  const ineligible: CurrencyCents = {};
  for (const charge of succeeded) {
    const net = charge.amount - charge.amount_refunded;
    const ms = charge.created * 1000;
    const inWindow =
      windowStart !== null && windowEnd !== null && ms >= windowStart.getTime() && ms < windowEnd.getTime();
    add(inWindow ? eligible : ineligible, charge.currency, net);
  }

  const commission: CurrencyCents = {};
  for (const [currency, cents] of Object.entries(eligible)) {
    commission[currency] = Math.floor((Math.max(cents, 0) * terms.commissionBps) / 10_000);
  }

  return {
    firstPaidAt: windowStart?.toISOString() ?? null,
    windowEndsAt: windowEnd?.toISOString() ?? null,
    eligible,
    ineligible,
    commission,
    chargeCount: succeeded.length,
  };
}

export function sumCurrencies(values: CurrencyCents[]): CurrencyCents {
  const total: CurrencyCents = {};
  for (const value of values) {
    for (const [currency, cents] of Object.entries(value)) add(total, currency, cents);
  }
  return total;
}

/** Commission earned minus payouts sent, by currency. Negative means overpaid. */
export function owed(commission: CurrencyCents, paid: CurrencyCents): CurrencyCents {
  const result: CurrencyCents = { ...commission };
  for (const [currency, cents] of Object.entries(paid)) add(result, currency, -cents);
  return result;
}
