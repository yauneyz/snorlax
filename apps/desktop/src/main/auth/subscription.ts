/**
 * Entitlement check (architecture §10). The web backend owns billing; the desktop just
 * pings `GET {API_BASE_URL}/api/desktop/entitlement` with the Supabase access token and
 * gates UI on the result.
 *
 * Offline policy: while a session exists we keep the last-known entitlement *indefinitely*
 * and only re-evaluate when an online call succeeds. Focus enforcement is independent (it
 * lives in the native service behind the USB-key disable gate), so entitlement is purely
 * feature-gating and must not strip a paying user's features over a network blip.
 *
 * Development builds can still override the plan from Settings (dev-override) so gated UI
 * can be exercised without a real subscription.
 */

import { app } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type Entitlement,
  type SubscriptionPlan,
  entitlementForPlan,
  entitlementSchema,
} from '@focuslock/product';
import { config } from '../config.js';
import { logger } from '../logging.js';
import { getAccessToken } from './supabase.js';

const DEFAULT_DEV_PLAN: SubscriptionPlan = 'pro';
const DEV_ENTITLEMENT_FILE = 'dev-entitlement.json';
const ENTITLEMENT_CACHE_FILE = 'entitlement-cache.json';

const SIGNED_OUT: Entitlement = entitlementForPlan('free', 'server');

let cachedDevEntitlement: Entitlement | undefined;

function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  return value === 'free' || value === 'pro';
}

async function userDataFile(name: string): Promise<string> {
  const dir = app.getPath('userData');
  await mkdir(dir, { recursive: true });
  return join(dir, name);
}

// --- dev override (non-production only) ---------------------------------------------------

async function loadDevEntitlement(): Promise<Entitlement> {
  if (cachedDevEntitlement) return cachedDevEntitlement;
  try {
    const raw = await readFile(await userDataFile(DEV_ENTITLEMENT_FILE), 'utf8');
    const parsed = JSON.parse(raw) as { plan?: unknown };
    cachedDevEntitlement = isSubscriptionPlan(parsed.plan)
      ? entitlementForPlan(parsed.plan, 'dev-override')
      : entitlementForPlan(DEFAULT_DEV_PLAN, 'dev-override');
  } catch {
    cachedDevEntitlement = entitlementForPlan(DEFAULT_DEV_PLAN, 'dev-override');
  }
  return cachedDevEntitlement;
}

export async function setDevEntitlementPlan(plan: SubscriptionPlan): Promise<Entitlement> {
  cachedDevEntitlement = entitlementForPlan(plan, 'dev-override');
  await writeFile(
    await userDataFile(DEV_ENTITLEMENT_FILE),
    `${JSON.stringify({ plan }, null, 2)}\n`,
    'utf8',
  );
  return cachedDevEntitlement;
}

// --- server entitlement cache (offline grace) --------------------------------------------

async function readCache(): Promise<Entitlement | undefined> {
  try {
    const raw = await readFile(await userDataFile(ENTITLEMENT_CACHE_FILE), 'utf8');
    return entitlementSchema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

async function writeCache(entitlement: Entitlement): Promise<void> {
  try {
    await writeFile(
      await userDataFile(ENTITLEMENT_CACHE_FILE),
      `${JSON.stringify(entitlement, null, 2)}\n`,
      'utf8',
    );
  } catch (e) {
    logger.warn('[entitlement] failed to persist cache', (e as Error).message);
  }
}

async function fetchServerEntitlement(token: string): Promise<Entitlement | undefined> {
  const url = `${config.apiBaseUrl}/api/desktop/entitlement`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) return undefined; // signed out / invalid token
  if (!res.ok) throw new Error(`Entitlement request failed: ${res.status}`);
  return entitlementSchema.parse(await res.json());
}

// --- public API ---------------------------------------------------------------------------

export async function getEntitlement(): Promise<Entitlement> {
  // Dev override short-circuits the network in non-production builds.
  if (config.appEnv !== 'production') return loadDevEntitlement();

  const token = await getAccessToken();
  if (!token) return SIGNED_OUT;

  try {
    const entitlement = await fetchServerEntitlement(token);
    if (!entitlement) return SIGNED_OUT;
    await writeCache(entitlement);
    return entitlement;
  } catch (e) {
    // Offline / server unreachable: keep the last-known entitlement indefinitely while a
    // session exists. Re-evaluation happens on the next successful call.
    const cached = await readCache();
    if (cached) {
      logger.warn('[entitlement] offline — serving cached entitlement', (e as Error).message);
      return { ...cached, source: 'offline' };
    }
    logger.warn('[entitlement] offline with no cache — defaulting to free', (e as Error).message);
    return SIGNED_OUT;
  }
}
