/**
 * Billing intents from the desktop. The web backend owns all Stripe logic; here we just call
 * the bearer-authenticated `/api/desktop/*` routes and open the returned Stripe URL in the
 * system browser. The checkout/portal return trips back in via `talysman://billing/*` deep
 * links (see window.ts), which trigger an entitlement refresh.
 */

import { shell } from 'electron';
import type { CheckoutPrice } from '@talysman/product';
import { config } from '../config.js';
import { getAccessToken } from './supabase.js';

interface BillingResult {
  ok: boolean;
  message?: string;
}

async function postForUrl(path: string, body?: unknown): Promise<BillingResult> {
  const token = await getAccessToken();
  if (!token) return { ok: false, message: 'Sign in first.' };

  try {
    const res = await fetch(`${config.apiBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (!res.ok || !data?.url) {
      return { ok: false, message: data?.error ?? `Request failed: ${res.status}` };
    }
    await shell.openExternal(data.url);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Open Stripe Checkout for the chosen plan in the system browser. */
export function startCheckout(price: CheckoutPrice): Promise<BillingResult> {
  return postForUrl('/api/desktop/checkout', { price });
}

/** Open the Stripe billing portal for an existing subscriber. */
export function openBillingPortal(): Promise<BillingResult> {
  return postForUrl('/api/desktop/portal');
}
