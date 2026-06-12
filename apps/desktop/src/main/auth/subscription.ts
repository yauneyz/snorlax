/**
 * Entitlement check (architecture §10). Stub for phases 1-2 — always returns "no
 * subscription required yet" so the app is fully usable. Phase 3 wires the Supabase edge
 * function + offline grace period.
 */

export interface Entitlement {
  active: boolean;
  source: 'stub' | 'edge-function' | 'cache';
}

export async function getEntitlement(): Promise<Entitlement> {
  return { active: true, source: 'stub' };
}
