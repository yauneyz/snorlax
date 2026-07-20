/**
 * Billing intents from the desktop. The web backend owns all Stripe logic; here we just call
 * the bearer-authenticated `/api/desktop/*` routes and open the returned Stripe URL in the
 * system browser. The checkout/portal return trips back in via `talysman://billing/*` deep
 * links (see window.ts), which trigger an entitlement refresh.
 */

import { shell } from 'electron';
import { subscriptionDetailSchema, type CheckoutPrice, type SubscriptionDetail } from '@talysman/product';
import { config } from '../config.js';
import { getAccessToken } from './supabase.js';

interface BillingResult {
  ok: boolean;
  message?: string;
}

type ApiResult =
  | { ok: true; data: unknown }
  | { ok: false; message: string };

async function callDesktopApi(
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<ApiResult> {
  const token = await getAccessToken();
  if (!token) return { ok: false, message: 'Sign in first.' };

  try {
    const res = await fetch(`${config.apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
      return { ok: false, message: data?.error ?? `Request failed: ${res.status}` };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

async function postForUrl(path: string, body?: unknown): Promise<BillingResult> {
  const res = await callDesktopApi(path, 'POST', body);
  if (!res.ok) return res;
  const url = (res.data as { url?: string } | null)?.url;
  if (!url) return { ok: false, message: 'Unexpected billing response.' };
  await shell.openExternal(url);
  return { ok: true };
}

/** Open Stripe Checkout for the chosen plan in the system browser. */
export function startCheckout(price: CheckoutPrice): Promise<BillingResult> {
  return postForUrl('/api/desktop/checkout', { price });
}

/** Open the Stripe billing portal for an existing subscriber. */
export function openBillingPortal(): Promise<BillingResult> {
  return postForUrl('/api/desktop/portal');
}

/** Current subscription snapshot for the Account page (display only, never cached). */
export async function fetchSubscriptionDetail(): Promise<{
  ok: boolean;
  detail?: SubscriptionDetail;
  message?: string;
}> {
  const res = await callDesktopApi('/api/desktop/subscription', 'GET');
  if (!res.ok) return res;
  const parsed = subscriptionDetailSchema.safeParse(res.data);
  if (!parsed.success) return { ok: false, message: 'Unexpected subscription response.' };
  return { ok: true, detail: parsed.data };
}

/** Schedule cancellation at the end of the current billing period. */
export async function cancelSubscription(): Promise<BillingResult> {
  const res = await callDesktopApi('/api/desktop/subscription/cancel', 'POST');
  return res.ok ? { ok: true } : res;
}

/** Un-schedule a pending cancellation. */
export async function resumeSubscription(): Promise<BillingResult> {
  const res = await callDesktopApi('/api/desktop/subscription/resume', 'POST');
  return res.ok ? { ok: true } : res;
}
