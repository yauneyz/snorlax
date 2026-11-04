/**
 * Emergency unlock confirmation (spec §3.7). Keyless, up to 5 per device, one back each month: turns everything
 * off — locked windows included — until you or a schedule turn it back on. It never authorizes
 * anything else; that's what makes it safe to offer wherever a key prompt appears.
 */
import React, { useState } from 'react';
import { EMERGENCY_UNLOCK_CAP, emergencyRefillIn } from '@talysman/shared';
import { useFocusStore } from '../store/useFocusStore.js';
import { runCommand } from '../lib/engine.js';
import { Button, Modal } from './ui/index.js';

export function EmergencyConfirm({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const left = useFocusStore((s) => s.engine.emergencyLeft);
  const refillAtMs = useFocusStore((s) => s.engine.emergencyRefillAtMs);
  const streak = useFocusStore((s) => s.engine.streak.currentDays);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await runCommand({ type: 'emergencyUnlock' });
      onDone?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Emergency unlock" onClose={onClose} width={420}>
      {left === 0 ? (
        <p className="text-body text-slate-300">
          You’ve used all {EMERGENCY_UNLOCK_CAP} emergency unlocks on this device.
          {refillAtMs !== null && ` The next one comes back ${emergencyRefillIn(refillAtMs, Date.now())}.`}
        </p>
      ) : (
        <>
          <p className="text-body leading-relaxed text-slate-300">
            Use 1 of your {left} remaining emergency unlocks? Everything will turn off — even locked
            windows — until you (or a schedule) turn it back on. You get one back every 30 days.
            {streak > 0 && ` Your ${streak}-day streak will reset.`}
          </p>
          <p className="mt-2 text-caption text-slate-450">
            Lost your key? After this you can pair a new one from the Keys page.
          </p>
          {error && <p className="mt-3 text-caption text-dangerInk">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void confirm()}>
              Use emergency unlock
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
