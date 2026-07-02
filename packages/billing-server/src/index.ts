import Stripe from 'stripe';
import {
  checkoutPriceSchema,
  entitlementForPlan,
  type CheckoutPrice,
  type Entitlement,
} from '@talysman/product';

export const STRIPE_API_VERSION = '2026-05-27.dahlia';

export interface StripeClientConfig {
  secretKey: string;
  appName: string;
  appUrl: string;
}

export interface BillingConfig {
  appUrl: string;
  priceMonthly: string;
  priceYearly: string;
  portalConfigId?: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface SupabaseTableClient {
  from(table: string): any;
}

interface CheckoutProfile {
  id: string;
  email: string | null;
  stripe_customer_id: string | null;
  full_name: string | null;
}

interface PortalProfile {
  stripe_customer_id: string | null;
}

interface ActiveSubscription {
  status?: string;
  current_period_end?: string;
}

export class NoStripeCustomerError extends Error {
  constructor() {
    super('No billing account yet - subscribe first.');
    this.name = 'NoStripeCustomerError';
  }
}

export function createStripeClient(config: StripeClientConfig): Stripe {
  return new Stripe(config.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    appInfo: {
      name: config.appName,
      url: config.appUrl,
    },
  });
}

export function priceIdForCheckoutPrice(price: CheckoutPrice, config: BillingConfig): string {
  const parsed = checkoutPriceSchema.parse(price);
  return parsed === 'yearly' ? config.priceYearly : config.priceMonthly;
}

export async function createCheckoutSession(args: {
  db: SupabaseTableClient;
  stripe: Stripe;
  config: BillingConfig;
  userId: string;
  userEmail: string;
  price: CheckoutPrice;
}): Promise<{ url: string }> {
  const { db, stripe, config, userId, userEmail, price } = args;

  const { data: rawProfile, error } = await db
    .from('profiles')
    .select('id,email,stripe_customer_id,full_name')
    .eq('id', userId)
    .single();
  const profile = rawProfile as CheckoutProfile | null;
  if (error || !profile) throw new Error(`Profile not found for user ${userId}`);

  let customerId = profile.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: profile.email ?? userEmail,
      name: profile.full_name ?? undefined,
      metadata: { user_id: userId },
    });

    const { data: rawClaimed } = await db
      .from('profiles')
      .update({ stripe_customer_id: customer.id })
      .eq('id', userId)
      .is('stripe_customer_id', null)
      .select('stripe_customer_id')
      .maybeSingle();
    const claimed = rawClaimed as Pick<CheckoutProfile, 'stripe_customer_id'> | null;

    if (claimed?.stripe_customer_id) {
      customerId = customer.id;
    } else {
      const { data: rawWinner } = await db
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', userId)
        .single();
      const winner = rawWinner as Pick<CheckoutProfile, 'stripe_customer_id'> | null;
      customerId = winner?.stripe_customer_id ?? customer.id;
      if (customerId !== customer.id) {
        await stripe.customers.del(customer.id).catch(() => undefined);
      }
    }
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceIdForCheckoutPrice(price, config), quantity: 1 }],
    allow_promotion_codes: true,
    success_url:
      config.successUrl ??
      `${config.appUrl}/api/stripe/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: config.cancelUrl ?? `${config.appUrl}/pricing?checkout=cancelled`,
    client_reference_id: userId,
    subscription_data: {
      metadata: { user_id: userId },
    },
  });

  if (!session.url) throw new Error('Stripe did not return a Checkout URL');
  return { url: session.url };
}

export async function createPortalSession(args: {
  db: SupabaseTableClient;
  stripe: Stripe;
  config: Pick<BillingConfig, 'appUrl' | 'portalConfigId'>;
  userId: string;
}): Promise<{ url: string }> {
  const { db, stripe, config, userId } = args;

  const { data: rawProfile, error } = await db
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .single();
  const profile = rawProfile as PortalProfile | null;
  if (error || !profile?.stripe_customer_id) {
    throw new NoStripeCustomerError();
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${config.appUrl}/account`,
    ...(config.portalConfigId ? { configuration: config.portalConfigId } : {}),
  });
  return { url: session.url };
}

export async function syncSubscription(args: {
  db: SupabaseTableClient;
  subscription: Stripe.Subscription;
}) {
  const { db, subscription } = args;
  const userId = await resolveUserId(db, subscription);
  if (!userId) {
    throw new Error(`Cannot resolve user_id for subscription ${subscription.id}`);
  }

  const item = subscription.items.data[0];
  if (!item) {
    throw new Error(`Subscription ${subscription.id} has no items`);
  }

  const row = {
    id: subscription.id,
    user_id: userId,
    status: subscription.status,
    price_id: item.price.id,
    quantity: item.quantity ?? 1,
    cancel_at_period_end: subscription.cancel_at_period_end,
    current_period_start: new Date(item.current_period_start * 1000).toISOString(),
    current_period_end: new Date(item.current_period_end * 1000).toISOString(),
    cancel_at: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null,
    canceled_at: subscription.canceled_at
      ? new Date(subscription.canceled_at * 1000).toISOString()
      : null,
    trial_start: subscription.trial_start
      ? new Date(subscription.trial_start * 1000).toISOString()
      : null,
    trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
  };

  const { error } = await db.from('subscriptions').upsert(row, { onConflict: 'id' });
  if (error) throw new Error(`Failed to upsert subscription ${subscription.id}: ${error.message}`);
  return row;
}

export async function getUserEntitlement(args: {
  db: SupabaseTableClient;
  userId: string;
  now?: Date;
  cacheTtlMs?: number;
}): Promise<Entitlement> {
  const { db, userId, now = new Date(), cacheTtlMs = 5 * 60 * 1000 } = args;

  const { data, error } = await db
    .from('active_subscriptions')
    .select('status,current_period_end')
    .eq('user_id', userId)
    .limit(1);
  if (error) throw new Error(`Failed to load entitlement: ${error.message}`);

  const subscription = Array.isArray(data)
    ? (data[0] as ActiveSubscription | undefined)
    : (data as ActiveSubscription | null);

  if (!subscription) {
    return entitlementForPlan('free', 'server', {
      fetchedAt: now.toISOString(),
      cacheUntil: new Date(now.getTime() + cacheTtlMs).toISOString(),
    });
  }

  return entitlementForPlan('pro', 'server', {
    status: subscription.status,
    currentPeriodEnd: subscription.current_period_end,
    fetchedAt: now.toISOString(),
    cacheUntil: new Date(now.getTime() + cacheTtlMs).toISOString(),
  });
}

async function resolveUserId(
  db: SupabaseTableClient,
  sub: Stripe.Subscription,
): Promise<string | null> {
  const metaUserId = (sub.metadata?.user_id as string | undefined) ?? null;
  if (metaUserId) return metaUserId;

  const customerMetaUserId =
    typeof sub.customer !== 'string' && !sub.customer.deleted
      ? ((sub.customer.metadata?.user_id as string | undefined) ?? null)
      : null;
  if (customerMetaUserId) return customerMetaUserId;

  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const { data: rawProfile } = await db
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  const profile = rawProfile as { id: string } | null;
  return profile?.id ?? null;
}
