/**
 * Entitlement check (architecture section 10). Stub for phases 1-2. Development builds can
 * override the current plan from Settings so billing-gated UI can be exercised before Phase 3
 * wires the Supabase edge function and offline grace period.
 */

import { app } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.js';
import type { SubscriptionPlan } from '../../shared/productLimits.js';

export interface Entitlement {
  active: boolean;
  plan: SubscriptionPlan;
  source: 'stub' | 'dev-override' | 'edge-function' | 'cache';
}

const DEFAULT_DEV_PLAN: SubscriptionPlan = 'pro';
const DEV_ENTITLEMENT_FILE = 'dev-entitlement.json';

let cachedDevEntitlement: Entitlement | undefined;

function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  return value === 'free' || value === 'pro';
}

function entitlementForPlan(
  plan: SubscriptionPlan,
  source: Entitlement['source'] = 'dev-override',
): Entitlement {
  return { active: plan === 'pro', plan, source };
}

async function devEntitlementPath(): Promise<string> {
  const dir = app.getPath('userData');
  await mkdir(dir, { recursive: true });
  return join(dir, DEV_ENTITLEMENT_FILE);
}

async function loadDevEntitlement(): Promise<Entitlement> {
  if (cachedDevEntitlement) return cachedDevEntitlement;

  try {
    const raw = await readFile(await devEntitlementPath(), 'utf8');
    const parsed = JSON.parse(raw) as { plan?: unknown };
    cachedDevEntitlement = isSubscriptionPlan(parsed.plan)
      ? entitlementForPlan(parsed.plan)
      : entitlementForPlan(DEFAULT_DEV_PLAN, 'stub');
  } catch {
    cachedDevEntitlement = entitlementForPlan(DEFAULT_DEV_PLAN, 'stub');
  }

  return cachedDevEntitlement;
}

export async function getEntitlement(): Promise<Entitlement> {
  if (config.appEnv === 'production') return entitlementForPlan(DEFAULT_DEV_PLAN, 'stub');
  return loadDevEntitlement();
}

export async function setDevEntitlementPlan(plan: SubscriptionPlan): Promise<Entitlement> {
  cachedDevEntitlement = entitlementForPlan(plan);
  await writeFile(await devEntitlementPath(), `${JSON.stringify({ plan }, null, 2)}\n`, 'utf8');
  return cachedDevEntitlement;
}
