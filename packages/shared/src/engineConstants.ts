/** Mirrors `EMERGENCY_UNLOCK_CAP` in native/engine/src/model.rs: most emergency unlocks a device holds. */
export const EMERGENCY_UNLOCK_CAP = 5;
/** Mirrors `EMERGENCY_REFILL_MS` in native/engine/src/model.rs: one emergency unlock comes back every 30 days. */
export const EMERGENCY_REFILL_DAYS = 30;

/** "in 12 days" / "tomorrow" / "today" until an emergency unlock comes back. */
export function emergencyRefillIn(refillAtMs: number, nowMs: number): string {
  const days = Math.ceil((refillAtMs - nowMs) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}
