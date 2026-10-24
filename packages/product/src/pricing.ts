import { z } from 'zod';

export const CHECKOUT_PRICES = ['monthly', 'yearly', 'lifetime'] as const;
/** The two recurring cycles — excludes 'lifetime', which is a one-time payment, not a cycle. */
export const RECURRING_CHECKOUT_PRICES = ['monthly', 'yearly'] as const;

/**
 * Length of the full-featured Pro trial started at Checkout. Stripe is the authority
 * once a subscription exists (`trial_end` is synced onto the row); this constant is
 * what we *ask* Stripe for, and what the marketing copy must quote.
 */
export const PRO_TRIAL_DAYS = 14;

/**
 * List prices in cents, mirroring the Stripe prices named by STRIPE_PRICE_MONTHLY /
 * STRIPE_PRICE_YEARLY. Kept here so the pricing page can do the annual math instead of
 * hardcoding "$8.33" in copy that silently rots when a price changes. Stripe remains the
 * source of truth for what is actually charged — these only drive display.
 */
export const PRO_PRICE_CENTS = {
  monthly: 499,
  yearly: 4999,
} as const satisfies Record<(typeof RECURRING_CHECKOUT_PRICES)[number], number>;

/** What a year on the annual plan saves against twelve monthly charges, in cents. */
export const PRO_ANNUAL_SAVINGS_CENTS = PRO_PRICE_CENTS.monthly * 12 - PRO_PRICE_CENTS.yearly;

/** The annual plan's savings against twelve monthly charges, as a whole percent. */
export const PRO_ANNUAL_SAVINGS_PERCENT = Math.round(
  (PRO_ANNUAL_SAVINGS_CENTS / (PRO_PRICE_CENTS.monthly * 12)) * 100,
);

/** The annual plan's cost per week, in cents — backs the "less than $1/week" copy. */
export const PRO_ANNUAL_WEEKLY_CENTS = PRO_PRICE_CENTS.yearly / 52;

/** One-time price for permanent Pro access, in cents — no cycle, no renewal. */
export const LIFETIME_PRICE_CENTS = 14900;

/**
 * Cents as a display price: `$10`, `$8.33`. Fractional cents round *down* so an
 * advertised "per month" figure can never overstate what twelve of them cost.
 */
export function formatPriceUsd(cents: number): string {
  const whole = Math.floor(cents / 100);
  const remainder = Math.floor(cents % 100);
  return remainder === 0 ? `$${whole}` : `$${whole}.${String(remainder).padStart(2, '0')}`;
}

export const checkoutPriceSchema = z.enum(CHECKOUT_PRICES);
export type CheckoutPrice = z.infer<typeof checkoutPriceSchema>;
